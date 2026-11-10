package app

import (
	"fmt"
	"log"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	me     = "@request.auth.id"
	authed = `@request.auth.id != ""`
)

// canSee er tilgangsregelen for ei liste. prefix peikar frå samlinga regelen står på, fram til lista.
func canSee(prefix string) string {
	return fmt.Sprintf(`(%[1]sowner = %[2]s || (%[1]svisibility = "shared" && (%[1]seditors.id ?= %[2]s || %[1]sviewers.id ?= %[2]s)))`, prefix, me)
}

func canEdit(prefix string) string {
	return fmt.Sprintf(`(%[1]sowner = %[2]s || (%[1]svisibility = "shared" && %[1]seditors.id ?= %[2]s))`, prefix, me)
}

// Ingen lister blir delte med alle med konto. Kven som ser ei liste, vel eigaren person for person.
// Verdien "family" står att i skjemaet berre så gamle data kan lesast og ryddast.
const noFamily = `@request.body.visibility != "family"`

// unshareFamilyLists gjer om lister som var delte med alle. Har lista utvalde personar, held ho fram
// med berre dei. Delingslenka blir trekt tilbake, sidan alle med konto kunne sjå ho.
func unshareFamilyLists(app core.App) error {
	records, err := app.FindRecordsByFilter("lists", `visibility = "family"`, "", 0, 0)
	if err != nil {
		return err
	}
	for _, r := range records {
		vis := "private"
		if len(r.GetStringSlice("editors")) > 0 || len(r.GetStringSlice("viewers")) > 0 {
			vis = "shared"
		}
		r.Set("visibility", vis)
		r.Set("share_token", "")
		if err := app.SaveNoValidate(r); err != nil {
			return err
		}
	}
	if len(records) > 0 {
		log.Printf("Gjorde om %d lister som var delte med alle.", len(records))
	}
	return nil
}

// notSpoiled skjuler ei planlagd gåve for den ho er meint til.
const notSpoiled = `(list.kind = "wishes" || created_by = @request.auth.id || recipients.user != @request.auth.id)`

// wishPrivate skjuler reservasjonar og kommentarar for den som ønskjer seg gåva.
const wishPrivate = `gift.list.kind = "wishes" && gift.list.person.user != @request.auth.id`

func all(parts ...string) string { return strings.Join(parts, " && ") }

func rule(s string) *string { return types.Pointer(s) }

func upsert(app core.App, name string, apply func(c *core.Collection)) (*core.Collection, error) {
	c, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		c = core.NewBaseCollection(name)
	}
	apply(c)
	c.Fields.Add(
		&core.AutodateField{Name: "created", OnCreate: true},
		&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
	)
	if err := app.Save(c); err != nil {
		return nil, fmt.Errorf("lagre samling %s: %w", name, err)
	}
	return c, nil
}

func floatPtr(v float64) *float64 { return &v }

// ensureSchema legg skjemaet og tilgangsreglane inn att ved kvar oppstart, så koden er fasit.
func ensureSchema(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.ListRule = rule(authed)
	users.ViewRule = rule(authed)
	users.CreateRule = nil // Registrering går berre via invitasjonsruta.
	users.UpdateRule = rule(all("id = "+me, `@request.body.is_owner:isset = false`, `@request.body.disabled:isset = false`, `@request.body.password_reset_at:isset = false`))
	users.DeleteRule = nil
	users.Fields.Add(
		&core.TextField{Name: "color", Max: 20},
		&core.BoolField{Name: "is_owner"},
		&core.BoolField{Name: "disabled"},
		&core.TextField{Name: "password_reset_at", Max: 40},
	)
	users.AuthToken.Duration = 60 * 60 * 24 * 45
	users.FileToken.Duration = 60 * 60 * 24
	users.OAuth2.Enabled = false
	if err := app.Save(users); err != nil {
		return fmt.Errorf("lagre users: %w", err)
	}

	people, err := upsert(app, "people", func(c *core.Collection) {
		// Alle med konto kan finne kvarandre. Personar utan konto ser berre den som la dei inn,
		// og dei som alt har valt personen som mottakar.
		// Regelen blir fullført nedanfor, når samlinga med mottakarar finst.
		c.ListRule = rule(all(authed, fmt.Sprintf(`(user != "" || created_by = %[1]s)`, me)))
		c.ViewRule = c.ListRule
		// Kven som ber kostnadene, kan berre endrast gjennom ruta som krev samtykke.
		guarded := []string{"@request.body.user:isset = false", "@request.body.covered_by:isset = false", "@request.body.covered_request:isset = false", "@request.body.covered_request_by:isset = false"}
		// Detaljar og bilete av andre ligg i person_notes og photos, der berre den som skreiv dei ser dei.
		// På sjølve personen kan berre personen sjølv skrive slikt, og det ser alle med konto.
		unset := make([]string, 0, len(personDetails))
		for _, f := range personDetails {
			unset = append(unset, "@request.body."+f+":isset = false")
		}
		c.CreateRule = rule(all(append(append([]string{authed, "@request.body.created_by = " + me}, guarded...), unset...)...))
		c.UpdateRule = rule(all(append([]string{authed, fmt.Sprintf(`(user = %[1]s || created_by = %[1]s)`, me), fmt.Sprintf("(user = %s || %s)", me, all(unset...)), "@request.body.created_by:isset = false"}, guarded...)...))
		c.DeleteRule = rule(all(authed, `user = ""`, "created_by = "+me))
		c.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 80},
			&core.TextField{Name: "relation", Max: 80},
			&core.TextField{Name: "color", Max: 20},
			&core.NumberField{Name: "birth_year", OnlyInt: true, Min: floatPtr(1900), Max: floatPtr(2100)},
			&core.TextField{Name: "interests", Max: 2000},
			&core.TextField{Name: "sizes", Max: 1000},
			&core.SelectField{Name: "gender", MaxSelect: 1, Values: []string{"female", "male", "other"}},
			&core.SelectField{Name: "age_group", MaxSelect: 1, Values: []string{"child", "teen", "adult", "elder"}},
			&core.TextField{Name: "vipps", Max: 30},
			&core.BoolField{Name: "no_simplify"},
			&core.NumberField{Name: "budget", Min: floatPtr(0)},
			&core.FileField{Name: "avatar", MaxSelect: 1, MaxSize: 8 << 20, MimeTypes: imageTypes, Thumbs: []string{"160x160"}},
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1},
			&core.RelationField{Name: "created_by", CollectionId: users.Id, MaxSelect: 1},
		)
		c.AddIndex("idx_people_user", true, "user", "user != ''")
	})
	if err != nil {
		return err
	}

	// Ein relasjon til samlinga sjølv kan fyrst leggjast til når samlinga finst.
	people, err = upsert(app, "people", func(c *core.Collection) {
		c.Fields.Add(
			&core.RelationField{Name: "covered_by", CollectionId: c.Id, MaxSelect: 1},
			&core.RelationField{Name: "covered_request", CollectionId: c.Id, MaxSelect: 1},
			&core.RelationField{Name: "covered_request_by", CollectionId: users.Id, MaxSelect: 1},
		)
	})
	if err != nil {
		return err
	}

	lists, err := upsert(app, "lists", func(c *core.Collection) {
		c.ListRule = rule(all(authed, canSee("")))
		c.ViewRule = rule(all(authed, canSee("")))
		c.CreateRule = rule(all(authed, "@request.body.owner = "+me, noFamily, `(@request.body.kind = "plan" || @request.body.person != "")`))
		// Listetype og person styrer spoilarvernet, så dei kan ikkje endrast etterpå.
		c.UpdateRule = rule(all(authed, noFamily, `@request.body.owner:isset = false`, `@request.body.kind:isset = false`, `@request.body.person:isset = false`, `@request.body.year:isset = false`, `@request.body.share_token:isset = false`, fmt.Sprintf(`(owner = %[1]s || (visibility = "shared" && editors.id ?= %[1]s && @request.body.editors:isset = false && @request.body.viewers:isset = false && @request.body.visibility:isset = false))`, me)))
		c.DeleteRule = rule(all(authed, "owner = "+me))
		c.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 120},
			&core.TextField{Name: "description", Max: 1000},
			&core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{"wishes", "plan"}},
			&core.SelectField{Name: "visibility", Required: true, MaxSelect: 1, Values: []string{"private", "family", "shared"}},
			&core.NumberField{Name: "year", OnlyInt: true},
			&core.NumberField{Name: "budget", Min: floatPtr(0)},
			&core.SelectField{Name: "occasion", MaxSelect: 1, Values: []string{"jul", "birthday", "confirmation", "wedding", "other"}},
			&core.TextField{Name: "event_date", Max: 10},
			&core.TextField{Name: "share_token", Max: 64},
			&core.RelationField{Name: "owner", CollectionId: users.Id, MaxSelect: 1, Required: true},
			&core.RelationField{Name: "person", CollectionId: people.Id, MaxSelect: 1},
			&core.RelationField{Name: "editors", CollectionId: users.Id, MaxSelect: 200},
			&core.RelationField{Name: "viewers", CollectionId: users.Id, MaxSelect: 200},
		)
	})
	if err != nil {
		return err
	}

	gifts, err := upsert(app, "gifts", func(c *core.Collection) {
		// Medgjevarar ser gåva sjølv om lista er privat, og kan følgje ho opp, men ikkje byte kven ho er til eller frå.
		giver := "givers.user ?= " + me
		// Eit enkelt ønske kan delast med utvalde, utan å dele heile lista.
		view := all(authed, fmt.Sprintf("(%s || %s || shared_with.id ?= %s)", canSee("list."), giver, me), notSpoiled)
		c.ListRule = rule(view)
		c.ViewRule = rule(view)
		c.CreateRule = rule(all(authed, "@request.body.created_by = "+me, canEdit("list.")))
		c.UpdateRule = rule(all(authed, notSpoiled, "@request.body.list:isset = false", "@request.body.created_by:isset = false",
			fmt.Sprintf("(%s || (%s && @request.body.givers:isset = false && @request.body.recipients:isset = false && @request.body.shared_with:isset = false))", canEdit("list."), giver)))
		c.DeleteRule = rule(all(authed, canEdit("list."), notSpoiled))
		c.Fields.Add(
			&core.RelationField{Name: "list", CollectionId: lists.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "title", Required: true, Max: 200},
			&core.URLField{Name: "url"},
			&core.TextField{Name: "shop", Max: 120},
			&core.TextField{Name: "note", Max: 4000},
			&core.TextField{Name: "rhyme", Max: 1000},
			&core.NumberField{Name: "best_price", Min: floatPtr(0)},
			&core.TextField{Name: "best_shop", Max: 120},
			&core.URLField{Name: "best_url"},
			&core.TextField{Name: "best_checked", Max: 40},
			&core.BoolField{Name: "watch_price"},
			&core.BoolField{Name: "archived"},
			&core.JSONField{Name: "offers", MaxSize: 20000},
			&core.NumberField{Name: "price", Min: floatPtr(0)},
			&core.NumberField{Name: "priority", OnlyInt: true, Min: floatPtr(0), Max: floatPtr(2)},
			&core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"idea", "bought", "wrapped", "given"}},
			// Verna: biletet følgjer same tilgang som gåva, så ei kjend adresse avslører ingenting.
			&core.FileField{Name: "image", MaxSelect: 1, MaxSize: 10 << 20, MimeTypes: imageTypes, Thumbs: []string{"480x480", "960x0"}, Protected: true},
			&core.RelationField{Name: "recipients", CollectionId: people.Id, MaxSelect: 50},
			&core.RelationField{Name: "givers", CollectionId: people.Id, MaxSelect: 50},
			&core.RelationField{Name: "created_by", CollectionId: users.Id, MaxSelect: 1},
			&core.RelationField{Name: "shared_with", CollectionId: users.Id, MaxSelect: 200},
		)
		c.AddIndex("idx_gifts_list", false, "list", "")
	})
	if err != nil {
		return err
	}

	// Den som er med og gjev ei gåve, får sjå lista ho ligg i, men ikkje dei andre gåvene der.
	// Regelen peikar tilbake frå gåvene, så han kan fyrst setjast når dei finst.
	_, err = upsert(app, "lists", func(c *core.Collection) {
		view := all(authed, fmt.Sprintf("(%[1]s || gifts_via_list.givers.user ?= %[2]s || gifts_via_list.shared_with.id ?= %[2]s)", canSee(""), me))
		c.ListRule = rule(view)
		c.ViewRule = rule(view)
	})
	if err != nil {
		return err
	}

	_, err = upsert(app, "claims", func(c *core.Collection) {
		view := all(authed, fmt.Sprintf("(%s || gift.shared_with.id ?= %s)", canSee("gift.list."), me), wishPrivate)
		c.ListRule = rule(view)
		c.ViewRule = rule(view)
		c.CreateRule = rule(all(view, "@request.body.user = "+me))
		c.UpdateRule = rule(all(authed, "user = "+me, "@request.body.user:isset = false", "@request.body.gift:isset = false", "@request.body.year:isset = false"))
		c.DeleteRule = rule(all(authed, "user = "+me))
		c.Fields.Add(
			&core.RelationField{Name: "gift", CollectionId: gifts.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"reserved", "bought"}},
			&core.NumberField{Name: "amount", Min: floatPtr(0)},
			&core.NumberField{Name: "year", OnlyInt: true},
			&core.BoolField{Name: "join_ok"},
		)
		c.RemoveIndex("idx_claims_unique")
		c.AddIndex("idx_claims_unique", true, "gift, user, year", "")
	})
	if err != nil {
		return err
	}
	// Reservasjonar frå før feltet fanst, høyrer til året dei blei laga.
	if _, err := app.DB().NewQuery(`UPDATE claims SET year = CAST(strftime('%Y', created) AS INTEGER) WHERE year IS NULL OR year = 0`).Execute(); err != nil {
		return fmt.Errorf("oppdatere reservasjonar: %w", err)
	}

	_, err = upsert(app, "comments", func(c *core.Collection) {
		view := all(authed, fmt.Sprintf("(%[1]s || gift.givers.user ?= %[2]s || gift.shared_with.id ?= %[2]s)", canSee("gift.list."), me), fmt.Sprintf(`((%s) || (gift.list.kind = "plan" && (gift.created_by = %s || gift.recipients.user != %s)))`, wishPrivate, me, me))
		c.ListRule = rule(view)
		c.ViewRule = rule(view)
		c.CreateRule = rule(all(view, "@request.body.user = "+me))
		c.UpdateRule = nil
		c.DeleteRule = rule(all(authed, "user = "+me))
		c.Fields.Add(
			&core.RelationField{Name: "gift", CollectionId: gifts.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "text", Required: true, Max: 2000},
		)
		c.AddIndex("idx_comments_gift", false, "gift", "")
	})
	if err != nil {
		return err
	}

	// Reservasjonar frå gjester utan konto. Dei blir berre skrivne av ruta for deleleink.
	_, err = upsert(app, "guest_claims", func(c *core.Collection) {
		view := all(authed, fmt.Sprintf("(%s || gift.shared_with.id ?= %s)", canSee("gift.list."), me), wishPrivate)
		c.ListRule = rule(view)
		c.ViewRule = rule(view)
		c.Fields.Add(
			&core.RelationField{Name: "gift", CollectionId: gifts.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "name", Required: true, Max: 60},
			&core.TextField{Name: "secret", Required: true, Max: 64, Hidden: true},
			&core.NumberField{Name: "year", OnlyInt: true},
		)
	})
	if err != nil {
		return err
	}

	// Kvar eining vel sjølv kva varsel ho vil ha.
	newChat := false
	_, err = upsert(app, "push_subs", func(c *core.Collection) {
		newChat = c.Fields.GetByName("chat") == nil
		mine := all(authed, "user = "+me)
		c.ListRule = rule(mine)
		c.ViewRule = rule(mine)
		c.CreateRule = rule(all(authed, "@request.body.user = "+me))
		c.UpdateRule = rule(all(mine, "@request.body.user:isset = false"))
		c.DeleteRule = rule(mine)
		c.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "endpoint", Required: true, Max: 2000},
			&core.TextField{Name: "p256dh", Required: true, Max: 300},
			&core.TextField{Name: "auth", Required: true, Max: 300},
			&core.BoolField{Name: "wishes"},
			&core.BoolField{Name: "payments"},
			&core.BoolField{Name: "reminders"},
			&core.BoolField{Name: "prices"},
			&core.BoolField{Name: "chat"},
		)
		c.AddIndex("idx_push_endpoint", true, "endpoint", "")
	})
	if err != nil {
		return err
	}
	// Den som alt har slått på varsel, får òg varsel om prat når det kjem.
	if newChat {
		if _, err := app.DB().NewQuery(`UPDATE push_subs SET chat = TRUE`).Execute(); err != nil {
			return fmt.Errorf("slå på varsel om prat: %w", err)
		}
	}

	// Kva brukaren fekk, og kven som er takka. Privat for kvar brukar.
	_, err = upsert(app, "received", func(c *core.Collection) {
		mine := all(authed, "user = "+me)
		c.ListRule = rule(mine)
		c.ViewRule = rule(mine)
		c.CreateRule = rule(all(authed, "@request.body.user = "+me))
		c.UpdateRule = rule(all(mine, "@request.body.user:isset = false"))
		c.DeleteRule = rule(mine)
		c.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.NumberField{Name: "year", OnlyInt: true, Required: true},
			&core.TextField{Name: "key", Max: 40},
			&core.TextField{Name: "title", Required: true, Max: 200},
			&core.TextField{Name: "from_names", Max: 200},
			&core.BoolField{Name: "thanked"},
		)
	})
	if err != nil {
		return err
	}

	// Kvar brukar si private liste over kven som skal få gåve. Ingen andre, heller ikkje administrator, kan lese ho.
	_, err = upsert(app, "recipients", func(c *core.Collection) {
		mine := all(authed, "user = "+me)
		c.ListRule = rule(mine)
		c.ViewRule = rule(mine)
		c.CreateRule = rule(all(authed, "@request.body.user = "+me, fmt.Sprintf(`(@request.body.person.user != "" || @request.body.person.created_by = %[1]s)`, me)))
		c.UpdateRule = rule(all(mine, "@request.body.user:isset = false", "@request.body.person:isset = false", "@request.body.year:isset = false"))
		c.DeleteRule = rule(mine)
		c.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "person", CollectionId: people.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.NumberField{Name: "year", OnlyInt: true, Required: true},
			&core.NumberField{Name: "budget", Min: floatPtr(0)},
			&core.BoolField{Name: "done"},
			&core.NumberField{Name: "sort", OnlyInt: true},
		)
		c.AddIndex("idx_recipients_unique", true, "user, person, year", "")
	})
	if err != nil {
		return err
	}

	// Personar utan konto ser òg dei som alt har valt personen som mottakar.
	people, err = upsert(app, "people", func(c *core.Collection) {
		seePerson := all(authed, fmt.Sprintf(`(user != "" || created_by = %[1]s || recipients_via_person.user ?= %[1]s)`, me))
		c.ListRule = rule(seePerson)
		c.ViewRule = rule(seePerson)
	})
	if err != nil {
		return err
	}
	_, err = upsert(app, "recipients", func(c *core.Collection) {
		// Ein kan berre velje personar ein alt kan sjå, så ingen får tilgang ved å gjette ein id.
		c.CreateRule = rule(all(authed, "@request.body.user = "+me, fmt.Sprintf(`(@request.body.person.user != "" || @request.body.person.created_by = %[1]s || @request.body.person.recipients_via_person.user ?= %[1]s)`, me)))
	})
	if err != nil {
		return err
	}

	// Bilete av andre som berre den som la det inn, ser. Blir brukt så lenge personen ikkje har eit eige bilete.
	_, err = upsert(app, "photos", func(c *core.Collection) {
		mine := all(authed, "user = "+me)
		c.ListRule = rule(mine)
		c.ViewRule = rule(mine)
		c.CreateRule = rule(all(authed, "@request.body.user = "+me))
		c.UpdateRule = rule(all(mine, "@request.body.user:isset = false", "@request.body.person:isset = false"))
		c.DeleteRule = rule(mine)
		c.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "person", CollectionId: people.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.FileField{Name: "image", MaxSelect: 1, MaxSize: 8 << 20, MimeTypes: imageTypes, Thumbs: []string{"160x160"}, Protected: true, Required: true},
		)
		c.AddIndex("idx_photos_unique", true, "user, person", "")
	})
	if err != nil {
		return err
	}

	// Det kvar brukar veit om ein person: relasjon, alder, interesser og storleikar. Berre forfattaren ser det.
	_, err = upsert(app, "person_notes", func(c *core.Collection) {
		mine := all(authed, "user = "+me)
		c.ListRule = rule(mine)
		c.ViewRule = rule(mine)
		c.CreateRule = rule(all(authed, "@request.body.user = "+me))
		c.UpdateRule = rule(all(mine, "@request.body.user:isset = false", "@request.body.person:isset = false"))
		c.DeleteRule = rule(mine)
		c.Fields.Add(
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "person", CollectionId: people.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "relation", Max: 80},
			&core.NumberField{Name: "birth_year", OnlyInt: true, Min: floatPtr(1900), Max: floatPtr(2100)},
			&core.TextField{Name: "interests", Max: 2000},
			&core.TextField{Name: "sizes", Max: 1000},
			&core.SelectField{Name: "gender", MaxSelect: 1, Values: []string{"female", "male", "other"}},
			&core.SelectField{Name: "age_group", MaxSelect: 1, Values: []string{"child", "teen", "adult", "elder"}},
		)
		c.AddIndex("idx_person_notes_unique", true, "user, person", "")
	})
	if err != nil {
		return err
	}

	_, err = upsert(app, "expenses", func(c *core.Collection) {
		view := all(authed, "visible_to.id ?= "+me)
		c.ListRule = rule(view)
		c.ViewRule = rule(view)
		c.CreateRule = rule(all(authed, "@request.body.created_by = "+me))
		c.UpdateRule = rule(all(authed, "@request.body.created_by:isset = false", fmt.Sprintf("(created_by = %[1]s || payer_users.id ?= %[1]s)", me)))
		c.DeleteRule = rule(all(authed, fmt.Sprintf("(created_by = %[1]s || payer_users.id ?= %[1]s)", me)))
		c.Fields.Add(
			&core.TextField{Name: "title", Max: 200},
			&core.TextField{Name: "note", Max: 1000},
			&core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{"expense", "refund"}},
			&core.NumberField{Name: "amount", Required: true, OnlyInt: true, Min: floatPtr(1)},
			&core.TextField{Name: "currency", Max: 8},
			&core.NumberField{Name: "original_amount", Min: floatPtr(0)},
			&core.TextField{Name: "spent_on", Max: 10},
			&core.NumberField{Name: "year", OnlyInt: true},
			&core.RelationField{Name: "gift", CollectionId: gifts.Id, MaxSelect: 1},
			&core.JSONField{Name: "payers", MaxSize: 20000},
			&core.JSONField{Name: "shares", MaxSize: 20000},
			&core.JSONField{Name: "allocated", MaxSize: 20000},
			&core.JSONField{Name: "wallets", MaxSize: 20000},
			&core.RelationField{Name: "parties", CollectionId: people.Id, MaxSelect: 200},
			&core.RelationField{Name: "visible_to", CollectionId: users.Id, MaxSelect: 200},
			&core.RelationField{Name: "payer_users", CollectionId: users.Id, MaxSelect: 200},
			&core.RelationField{Name: "disputed_by", CollectionId: users.Id, MaxSelect: 200},
			&core.RelationField{Name: "created_by", CollectionId: users.Id, MaxSelect: 1, Required: true},
		)
	})
	if err != nil {
		return err
	}

	_, err = upsert(app, "settlements", func(c *core.Collection) {
		view := all(authed, "visible_to.id ?= "+me)
		c.ListRule = rule(view)
		c.ViewRule = rule(view)
		c.CreateRule = rule(all(authed, "@request.body.created_by = "+me))
		c.UpdateRule = rule(all(authed, "receivers.id ?= "+me, `status = "pending"`, `@request.body.status = "confirmed"`,
			"@request.body.amount:isset = false", "@request.body.from_person:isset = false", "@request.body.to_person:isset = false",
			"@request.body.kind:isset = false", "@request.body.created_by:isset = false",
			"@request.body.from_wallet:isset = false", "@request.body.to_wallet:isset = false", "@request.body.receivers:isset = false", "@request.body.visible_to:isset = false"))
		c.DeleteRule = rule(all(authed, fmt.Sprintf(`((created_by = %[1]s && (status = "pending" || receivers:length = 0)) || receivers.id ?= %[1]s)`, me)))
		c.Fields.Add(
			&core.RelationField{Name: "from_person", CollectionId: people.Id, MaxSelect: 1, Required: true},
			&core.RelationField{Name: "to_person", CollectionId: people.Id, MaxSelect: 1, Required: true},
			&core.TextField{Name: "from_wallet", Max: 40},
			&core.TextField{Name: "to_wallet", Max: 40},
			&core.NumberField{Name: "amount", Required: true, OnlyInt: true, Min: floatPtr(1)},
			&core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{"paid", "waived"}},
			&core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"pending", "confirmed"}},
			&core.SelectField{Name: "method", MaxSelect: 1, Values: []string{"vipps", "bank", "cash", "other"}},
			&core.TextField{Name: "note", Max: 500},
			&core.RelationField{Name: "receivers", CollectionId: users.Id, MaxSelect: 200},
			&core.RelationField{Name: "visible_to", CollectionId: users.Id, MaxSelect: 200},
			&core.RelationField{Name: "created_by", CollectionId: users.Id, MaxSelect: 1, Required: true},
		)
	})
	if err != nil {
		return err
	}

	// Ingen reglar: innstillingane blir berre lesne og skrivne gjennom administrasjonsrutene.
	_, err = upsert(app, "app_settings", func(c *core.Collection) {
		c.Fields.Add(
			&core.TextField{Name: "family_name", Max: 80},
			&core.TextField{Name: "home_region", Max: 80},
			&core.BoolField{Name: "no_auto_price"},
			&core.BoolField{Name: "signup_open"},
			&core.BoolField{Name: "ai_enabled"},
			&core.TextField{Name: "ai_model", Max: 80},
			&core.NumberField{Name: "ai_daily_limit", OnlyInt: true},
			&core.BoolField{Name: "simplify"},
		)
	})
	return err
}

var imageTypes = []string{"image/jpeg", "image/png", "image/webp", "image/gif"}

func applySettings(app core.App, cfg Config) error {
	s := app.Settings()
	s.Meta.AppName = "Pakkelapp"
	if cfg.PublicURL != "" {
		s.Meta.AppURL = cfg.PublicURL
	}
	s.TrustedProxy.Headers = []string{"CF-Connecting-IP"}
	s.Logs.MaxDays = 7
	s.Backups.Cron = "15 4 * * *"
	s.Backups.CronMaxKeep = 14
	s.RateLimits.Enabled = true
	s.RateLimits.Rules = []core.RateLimitRule{
		{Label: "*:auth", MaxRequests: 10, Duration: 60},
		{Label: "/api/jul/register", MaxRequests: 6, Duration: 60},
		{Label: "/api/jul/invite/", MaxRequests: 20, Duration: 60},
		{Label: "/api/jul/shared/", MaxRequests: 240, Duration: 60}, // Kvart bilete på lista er ein førespurnad.
		{Label: "/api/jul/ai/", MaxRequests: 20, Duration: 60},
		{Label: "/api/jul/admin", MaxRequests: 60, Duration: 60},
		{Label: "/api/jul/preview", MaxRequests: 30, Duration: 60},
		{Label: "/api/", MaxRequests: 900, Duration: 60},
	}
	return app.Save(s)
}
