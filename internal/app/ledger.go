package app

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/pocketbase/dbx"
	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

const minTransferOre = 100 // Under 1 krone er det ikkje verdt ei overføring.

func invalid(field, message string) error {
	return validation.Errors{field: validation.NewError("validation_invalid", message)}
}

// family held samanhengen mellom personar, kontoar og kven som ber kostnaden for kven.
type family struct {
	wallet   func(string) string
	members  map[string][]string // lommebok -> brukar-id-ar
	optedOut map[string]bool
	byUser   map[string]string
	people   map[string]*core.Record
}

func loadFamily(app core.App) (*family, error) {
	records, err := app.FindAllRecords("people")
	if err != nil {
		return nil, err
	}
	covered := map[string]string{}
	f := &family{members: map[string][]string{}, optedOut: map[string]bool{}, byUser: map[string]string{}, people: map[string]*core.Record{}}
	for _, p := range records {
		f.people[p.Id] = p
		if c := p.GetString("covered_by"); c != "" {
			covered[p.Id] = c
		}
	}
	f.wallet = WalletResolver(covered)
	for _, p := range records {
		w := f.wallet(p.Id)
		if u := p.GetString("user"); u != "" {
			f.members[w] = append(f.members[w], u)
			f.byUser[u] = p.Id
		}
		if p.GetBool("no_simplify") {
			f.optedOut[w] = true
		}
	}
	return f, nil
}

func uniqueStrings(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func (f *family) usersFor(people ...string) []string {
	var out []string
	for _, p := range people {
		out = append(out, f.members[f.wallet(p)]...)
	}
	return uniqueStrings(out)
}

// giftSpoilers er brukarane som ikkje skal få vite at gåva er kjøpt.
func giftSpoilers(app core.App, f *family, giftID string) (users map[string]bool, people []string) {
	users = map[string]bool{}
	if giftID == "" {
		return users, nil
	}
	gift, err := app.FindRecordById("gifts", giftID)
	if err != nil {
		return users, nil
	}
	people = append(people, gift.GetStringSlice("recipients")...)
	if list, err := app.FindRecordById("lists", gift.GetString("list")); err == nil && list.GetString("kind") == "wishes" {
		people = append(people, list.GetString("person"))
	}
	for _, id := range people {
		if p := f.people[id]; p != nil && p.GetString("user") != "" {
			users[p.GetString("user")] = true
		}
	}
	return users, people
}

func normalizeExpense(app core.App, r *core.Record) error {
	f, err := loadFamily(app)
	if err != nil {
		return err
	}
	var payers []Payer
	var shares []Share
	_ = r.UnmarshalJSONField("payers", &payers)
	_ = r.UnmarshalJSONField("shares", &shares)

	amount := int64(r.GetInt("amount"))
	if amount <= 0 {
		return invalid("amount", "Beløpet må vere større enn 0.")
	}
	if amount > 100_000_000 {
		return invalid("amount", "Beløpet er for stort.")
	}
	if len(payers) == 0 {
		return invalid("payers", "Vel kven som betalte.")
	}
	if len(payers) == 1 && payers[0].Ore == 0 {
		payers[0].Ore = amount
	}
	var paid int64
	seen := map[string]bool{}
	parties := make([]string, 0, len(payers)+len(shares))
	payerIDs := make([]string, 0, len(payers))
	for _, p := range payers {
		if f.people[p.Person] == nil {
			return invalid("payers", "Fann ikkje den som betalte.")
		}
		if seen[p.Person] {
			return invalid("payers", "Same person kan ikkje betale to gonger.")
		}
		if p.Ore <= 0 {
			return invalid("payers", "Kvar betalar må ha eit beløp over 0.")
		}
		seen[p.Person] = true
		paid += p.Ore
		parties = append(parties, p.Person)
		payerIDs = append(payerIDs, p.Person)
	}
	if paid != amount {
		return invalid("payers", fmt.Sprintf("Betalingane må bli %s til saman.", formatOre(amount)))
	}
	for _, s := range shares {
		if f.people[s.Person] == nil {
			return invalid("shares", "Fann ikkje alle som skal dele.")
		}
		parties = append(parties, s.Person)
	}
	allocated, err := Split(amount, shares, SplitKey(amount, shares))
	if err != nil {
		return invalid("shares", err.Error())
	}

	if r.GetString("title") == "" && r.GetString("gift") == "" {
		return invalid("title", "Skriv kva utlegget gjeld.")
	}
	date := r.GetString("spent_on")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return invalid("spent_on", "Ugyldig dato.")
	}

	parties = uniqueStrings(parties)
	// Serveren eig dette feltet: det klienten sender, blir aldri brukt.
	snapshot := map[string]string{}
	if !r.IsNew() {
		_ = r.Original().UnmarshalJSONField("wallets", &snapshot)
	}
	for _, p := range parties {
		if snapshot[p] == "" {
			snapshot[p] = f.wallet(p)
		}
	}

	// Den som er direkte med ser utlegget. Hushaldet ser det òg, med mindre gåva er ei overrasking for dei.
	spoiled, _ := giftSpoilers(app, f, r.GetString("gift"))
	direct := map[string]bool{r.GetString("created_by"): true}
	visible := []string{r.GetString("created_by")}
	for _, p := range parties {
		if u := f.people[p].GetString("user"); u != "" {
			direct[u] = true
			visible = append(visible, u)
		}
		for _, u := range f.usersFor(snapshot[p]) {
			if !spoiled[u] || direct[u] {
				visible = append(visible, u)
			}
		}
	}

	r.Set("payers", payers)
	r.Set("shares", shares)
	r.Set("allocated", allocated)
	r.Set("wallets", snapshot)
	r.Set("spent_on", date)
	r.Set("year", seasonYear(parsed))
	r.Set("parties", parties)
	r.Set("payer_users", f.usersFor(payerIDs...))
	r.Set("visible_to", uniqueStrings(visible))
	return nil
}

func formatOre(ore int64) string {
	if ore%100 == 0 {
		return fmt.Sprintf("%d kr", ore/100)
	}
	return fmt.Sprintf("%d,%02d kr", ore/100, ore%100)
}

func normalizeSettlement(app core.App, r *core.Record, creating bool) error {
	f, err := loadFamily(app)
	if err != nil {
		return err
	}
	from, to := r.GetString("from_person"), r.GetString("to_person")
	if f.people[from] == nil || f.people[to] == nil {
		return invalid("to_person", "Fann ikkje personen.")
	}
	if r.GetInt("amount") <= 0 {
		return invalid("amount", "Beløpet må vere større enn 0.")
	}
	receivers := f.usersFor(to)
	r.Set("receivers", receivers)
	r.Set("visible_to", uniqueStrings(append(f.usersFor(from, to), r.GetString("created_by"))))
	if !creating {
		// Kven betalinga gjeld, er bestemt då ho blei registrert.
		r.Set("from_wallet", r.Original().GetString("from_wallet"))
		r.Set("to_wallet", r.Original().GetString("to_wallet"))
		return nil
	}
	if f.wallet(from) == f.wallet(to) {
		return invalid("to_person", "Desse to deler lommebok, så det er ikkje noko å gjere opp.")
	}
	r.Set("from_wallet", f.wallet(from))
	r.Set("to_wallet", f.wallet(to))

	creator := r.GetString("created_by")
	// Berre partane, og den som styrer ein person utan konto, kan registrere oppgjer.
	involved := false
	for _, person := range []string{from, to} {
		w := f.wallet(person)
		for _, u := range f.members[w] {
			involved = involved || u == creator
		}
		if len(f.members[w]) == 0 && f.people[w].GetString("created_by") == creator {
			involved = true
		}
	}
	if !involved {
		return invalid("to_person", "Du kan berre registrere oppgjer du sjølv er ein del av.")
	}
	isReceiver := false
	for _, u := range receivers {
		isReceiver = isReceiver || u == creator
	}
	creditor := f.people[f.wallet(to)]
	mayWaive := isReceiver || (len(receivers) == 0 && creditor.GetString("created_by") == creator)
	if r.GetString("kind") == "waived" && !mayWaive {
		return invalid("kind", "Berre den som har til gode kan ettergje ei skuld.")
	}
	if isReceiver || len(receivers) == 0 {
		r.Set("status", "confirmed")
	} else {
		r.Set("status", "pending")
	}
	return nil
}

// registerLedgerHooks sørgjer for at reknestykka alltid blir gjort på serveren, uansett kven som lagrar.
func registerLedgerHooks(pb *pocketbase.PocketBase) {
	pb.OnRecordCreate("expenses").BindFunc(func(e *core.RecordEvent) error {
		if err := normalizeExpense(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	pb.OnRecordUpdate("expenses").BindFunc(func(e *core.RecordEvent) error {
		if err := normalizeExpense(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	// Når utlegget blir retta, er ei tidlegare innvending ikkje lenger gyldig.
	pb.OnRecordUpdateRequest("expenses").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("disputed_by", []string{})
		return e.Next()
	})
	pb.OnRecordCreate("settlements").BindFunc(func(e *core.RecordEvent) error {
		if err := normalizeSettlement(e.App, e.Record, true); err != nil {
			return err
		}
		return e.Next()
	})
	pb.OnRecordUpdate("settlements").BindFunc(func(e *core.RecordEvent) error {
		if err := normalizeSettlement(e.App, e.Record, false); err != nil {
			return err
		}
		return e.Next()
	})
	// Ein reservasjon gjeld éi jul. Neste år er ønsket ledig igjen.
	pb.OnRecordCreate("claims").BindFunc(func(e *core.RecordEvent) error {
		year := seasonYear(time.Now())
		e.Record.Set("year", year)
		// Vert eit ønske teke samtidig, må den andre velje å spleise med vilje.
		if !e.Record.GetBool("join_ok") {
			existing := dbx.HashExp{"gift": e.Record.GetString("gift"), "year": year}
			claims, err := e.App.CountRecords("claims", existing)
			if err != nil {
				return err
			}
			guests, err := e.App.CountRecords("guest_claims", existing)
			if err != nil {
				return err
			}
			if claims+guests > 0 {
				return invalid("gift", "Nokon rakk å ta denne før deg. Du kan bli med og spleise i staden.")
			}
		}
		return e.Next()
	})

	// Kven som ser eit utlegg, må følgje med når nokon får konto eller byter hushald.
	pb.OnRecordAfterUpdateSuccess("people").BindFunc(func(e *core.RecordEvent) error {
		old := e.Record.Original()
		if old.GetString("covered_by") != e.Record.GetString("covered_by") || old.GetString("user") != e.Record.GetString("user") {
			for _, col := range []string{"expenses", "settlements"} {
				records, err := e.App.FindAllRecords(col)
				if err != nil {
					log.Printf("oppdatere tilgang: %v", err)
					continue
				}
				for _, r := range records {
					if err := e.App.Save(r); err != nil {
						log.Printf("oppdatere tilgang %s/%s: %v", col, r.Id, err)
					}
				}
			}
		}
		return e.Next()
	})

	pb.OnRecordDelete("people").BindFunc(func(e *core.RecordEvent) error {
		used, err := e.App.CountRecords("expenses", dbx.NewExp("parties LIKE {:p}", dbx.Params{"p": "%" + e.Record.Id + "%"}))
		if err != nil {
			return err
		}
		paid, err := e.App.CountRecords("settlements", dbx.NewExp("from_person = {:p} OR to_person = {:p}", dbx.Params{"p": e.Record.Id}))
		if err != nil {
			return err
		}
		if used+paid > 0 {
			return invalid("name", "Personen har utlegg eller oppgjer og kan ikkje fjernast.")
		}
		return e.Next()
	})

	// Utlegg blir ståande når ei gåve blir sletta. Tittelen blir teken vare på, men aldri for ein mottakar.
	pb.OnRecordDelete("gifts").BindFunc(func(e *core.RecordEvent) error {
		expenses, err := e.App.FindAllRecords("expenses", dbx.HashExp{"gift": e.Record.Id})
		if err != nil {
			return err
		}
		if len(expenses) > 0 {
			f, err := loadFamily(e.App)
			if err != nil {
				return err
			}
			_, spoiled := giftSpoilers(e.App, f, e.Record.Id)
			hidden := map[string]bool{}
			for _, p := range spoiled {
				hidden[f.wallet(p)] = true
			}
			for _, x := range expenses {
				title := e.Record.GetString("title")
				for _, p := range x.GetStringSlice("parties") {
					if hidden[f.wallet(p)] {
						title = "Gåve"
					}
				}
				x.Set("title", title)
				x.Set("gift", "")
				if err := e.App.Save(x); err != nil {
					return err
				}
			}
		}
		return e.Next()
	})
}

func toExpense(r *core.Record) Expense {
	var payers []Payer
	alloc := map[string]int64{}
	wallets := map[string]string{}
	_ = r.UnmarshalJSONField("payers", &payers)
	_ = r.UnmarshalJSONField("allocated", &alloc)
	_ = r.UnmarshalJSONField("wallets", &wallets)
	return Expense{ID: r.Id, Refund: r.GetString("kind") == "refund", Payers: payers, Allocated: alloc, Wallets: wallets}
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func (s *server) settle(e *core.RequestEvent) error {
	f, err := loadFamily(e.App)
	if err != nil {
		return e.InternalServerError("", err)
	}
	cfg := s.settings(e.App)
	expenseRecords, err := e.App.FindAllRecords("expenses")
	if err != nil {
		return e.InternalServerError("", err)
	}
	settlementRecords, err := e.App.FindAllRecords("settlements", dbx.HashExp{"status": "confirmed"})
	if err != nil {
		return e.InternalServerError("", err)
	}

	me := f.wallet(f.byUser[e.Auth.Id])
	expenses := make([]Expense, 0, len(expenseRecords))
	disputed := 0
	for _, r := range expenseRecords {
		// Ei innvending er eit varsel til den som la inn utlegget. Summane står til det er retta.
		if len(r.GetStringSlice("disputed_by")) > 0 {
			for _, u := range r.GetStringSlice("visible_to") {
				if u == e.Auth.Id {
					disputed++
				}
			}
		}
		expenses = append(expenses, toExpense(r))
	}
	settlements := make([]Settlement, 0, len(settlementRecords))
	for _, r := range settlementRecords {
		settlements = append(settlements, Settlement{
			From: firstNonEmpty(r.GetString("from_wallet"), r.GetString("from_person")),
			To:   firstNonEmpty(r.GetString("to_wallet"), r.GetString("to_person")),
			Ore:  int64(r.GetInt("amount")),
		})
	}

	ledger := BuildLedger(expenses, settlements, f.wallet)
	canSimplify := func(w string) bool {
		return cfg.Simplify && len(f.members[w]) > 0 && !f.optedOut[w]
	}
	plan := Plan(ledger, canSimplify, minTransferOre)

	// Personar utan konto som denne brukaren sjølv har lagt til, kan den følgje opp på vegner av dei.
	manages := func(w string) bool {
		p := f.people[w]
		return p != nil && len(f.members[w]) == 0 && p.GetString("created_by") == e.Auth.Id
	}
	visible := make([]Transfer, 0, len(plan))
	var owe, owed int64
	for _, t := range plan {
		switch {
		case t.From == me:
			owe += t.Ore
			visible = append(visible, t)
		case t.To == me:
			owed += t.Ore
			visible = append(visible, t)
		case manages(t.From) || manages(t.To):
			visible = append(visible, t)
		}
	}
	wallets := make(map[string]string, len(f.people))
	info, err := e.RequestInfo()
	if err != nil {
		return e.InternalServerError("", err)
	}
	for id, person := range f.people {
		if allowed, _ := e.App.CanAccessRecord(person, info, person.Collection().ViewRule); allowed {
			wallets[id] = f.wallet(id)
		}
	}
	return e.JSON(http.StatusOK, map[string]any{"me": me, "owe": owe, "owed": owed, "transfers": visible, "wallets": wallets, "disputed": disputed})
}

func (s *server) settlePreview(e *core.RequestEvent) error {
	var body struct {
		Amount int64   `json:"amount"`
		Shares []Share `json:"shares"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	allocated, err := Split(body.Amount, body.Shares, SplitKey(body.Amount, body.Shares))
	if err != nil {
		return e.JSON(http.StatusOK, map[string]any{"error": err.Error()})
	}
	return e.JSON(http.StatusOK, map[string]any{"allocated": allocated})
}

// dispute lèt den som er med på eit utlegg varsle om at noko ikkje stemmer.
func (s *server) dispute(e *core.RequestEvent) error {
	r, err := e.App.FindRecordById("expenses", e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("Fann ikkje utlegget.", err)
	}
	allowed := false
	for _, u := range r.GetStringSlice("visible_to") {
		allowed = allowed || u == e.Auth.Id
	}
	if !allowed {
		return e.NotFoundError("Fann ikkje utlegget.", nil)
	}
	current := r.GetStringSlice("disputed_by")
	next := make([]string, 0, len(current)+1)
	had := false
	for _, u := range current {
		if u == e.Auth.Id {
			had = true
		} else {
			next = append(next, u)
		}
	}
	if !had {
		next = append(next, e.Auth.Id)
	}
	r.Set("disputed_by", next)
	if err := e.App.Save(r); err != nil {
		return e.BadRequestError("Kunne ikkje lagre.", err)
	}
	return e.NoContent(http.StatusNoContent)
}

// setCoveredBy endrar kven som ber kostnadene for ein person. Ingen kan få skuld lagt på seg utan å ha sagt ja.
func (s *server) setCoveredBy(e *core.RequestEvent) error {
	var body struct {
		PersonID string `json:"personId"`
		TargetID string `json:"targetId"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	person, err := e.App.FindRecordById("people", body.PersonID)
	if err != nil {
		return e.NotFoundError("Fann ikkje personen.", err)
	}
	actor := e.Auth.Id
	userOf := func(id string) string {
		if id == "" {
			return ""
		}
		if p, err := e.App.FindRecordById("people", id); err == nil {
			return p.GetString("user")
		}
		return ""
	}
	personUser := person.GetString("user")
	clearRequest := func() {
		person.Set("covered_request", "")
		person.Set("covered_request_by", "")
	}

	if body.TargetID == "" {
		allowed := personUser == actor || (personUser == "" && person.GetString("created_by") == actor) ||
			userOf(person.GetString("covered_by")) == actor || userOf(person.GetString("covered_request")) == actor
		if !allowed {
			return e.ForbiddenError("Du kan ikkje endre dette for denne personen.", nil)
		}
		person.Set("covered_by", "")
		clearRequest()
	} else {
		target, err := e.App.FindRecordById("people", body.TargetID)
		if err != nil {
			return e.NotFoundError("Fann ikkje personen.", err)
		}
		f, err := loadFamily(e.App)
		if err != nil {
			return e.InternalServerError("", err)
		}
		if target.Id == person.Id || f.wallet(target.Id) == person.Id {
			return e.BadRequestError("Hushaldet går allereie den andre vegen. Vel éin av dykk som kostnadene går via.", nil)
		}
		targetUser := target.GetString("user")
		switch {
		case personUser == "":
			if targetUser != actor || person.GetString("created_by") != actor {
				return e.ForbiddenError("Du kan berre ta på deg kostnadene sjølv.", nil)
			}
			person.Set("covered_by", target.Id)
			clearRequest()
		case targetUser == "":
			return e.BadRequestError("Den andre må ha konto for å kunne seie ja.", nil)
		case actor != personUser && actor != targetUser:
			return e.ForbiddenError("Du kan ikkje endre dette for andre.", nil)
		case person.GetString("covered_request") == target.Id && person.GetString("covered_request_by") != actor:
			person.Set("covered_by", target.Id)
			clearRequest()
		default:
			person.Set("covered_request", target.Id)
			person.Set("covered_request_by", actor)
		}
	}
	if err := e.App.Save(person); err != nil {
		return e.BadRequestError("Kunne ikkje lagre.", err)
	}
	return e.NoContent(http.StatusNoContent)
}
