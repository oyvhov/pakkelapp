package app

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func randomToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func isJulList(list *core.Record) bool {
	o := list.GetString("occasion")
	return o == "" || o == "jul"
}

// taken seier om ei gåve alt er teken, av ein med konto eller ein gjest.
func taken(app core.App, list, gift *core.Record, year int) bool {
	for _, col := range []string{"claims", "guest_claims"} {
		records, err := app.FindAllRecords(col, dbx.HashExp{"gift": gift.Id})
		if err != nil {
			continue
		}
		for _, r := range records {
			if !isJulList(list) || r.GetInt("year") == year {
				return true
			}
		}
	}
	return false
}

// setShare slår deleleinka for ei ønskeliste av eller på. Berre eigaren kan gjere det.
func (s *server) setShare(e *core.RequestEvent) error {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	list, err := e.App.FindRecordById("lists", e.Request.PathValue("id"))
	if err != nil || list.GetString("owner") != e.Auth.Id {
		return e.NotFoundError("Fann ikkje lista.", err)
	}
	if list.GetString("kind") != "wishes" {
		return e.BadRequestError("Berre ønskelister kan delast med lenke.", nil)
	}
	token := ""
	if body.Enabled {
		if token, err = randomToken(); err != nil {
			return e.InternalServerError("", err)
		}
	}
	list.Set("share_token", token)
	if err := e.App.Save(list); err != nil {
		return e.BadRequestError("Kunne ikkje lagre.", err)
	}
	return e.JSON(http.StatusOK, map[string]string{"token": token})
}

func (s *server) sharedRecord(e *core.RequestEvent) (*core.Record, error) {
	token := e.Request.PathValue("token")
	if len(token) < 32 {
		return nil, e.NotFoundError("Denne lenka verkar ikkje lenger.", nil)
	}
	list, err := e.App.FindFirstRecordByData("lists", "share_token", token)
	if err != nil {
		return nil, e.NotFoundError("Denne lenka verkar ikkje lenger.", err)
	}
	return list, nil
}

type sharedGift struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	URL      string  `json:"url"`
	Shop     string  `json:"shop"`
	Note     string  `json:"note"`
	Price    float64 `json:"price"`
	Priority int     `json:"priority"`
	Image    string  `json:"image"`
	Taken    bool    `json:"taken"`
}

func (s *server) sharedList(e *core.RequestEvent) error {
	list, err := s.sharedRecord(e)
	if err != nil {
		return err
	}
	personName, wisher := "", ""
	if p, err := e.App.FindRecordById("people", list.GetString("person")); err == nil {
		personName, wisher = strings.Fields(p.GetString("name") + " ?")[0], p.GetString("user")
	}
	// Opnar den som ønskjer seg lenka mens hen er innlogga, skal hen ikkje sjå kva som er teke.
	hideTaken := e.Auth != nil && e.Auth.Id == wisher

	records, err := e.App.FindAllRecords("gifts", dbx.HashExp{"list": list.Id, "archived": false})
	if err != nil {
		return e.InternalServerError("", err)
	}
	year := seasonYear(s.now())
	gifts := make([]sharedGift, 0, len(records))
	for _, g := range records {
		image := ""
		if name := g.GetString("image"); name != "" {
			image = fmt.Sprintf("/api/jul/shared/%s/image/%s", list.GetString("share_token"), g.Id)
		}
		gifts = append(gifts, sharedGift{g.Id, g.GetString("title"), g.GetString("url"), g.GetString("shop"), g.GetString("note"), g.GetFloat("price"), g.GetInt("priority"), image, !hideTaken && taken(e.App, list, g, year)})
	}
	return e.JSON(http.StatusOK, map[string]any{"name": list.GetString("name"), "person": personName, "own": hideTaken, "gifts": gifts})
}

func (s *server) sharedClaim(e *core.RequestEvent) error {
	list, err := s.sharedRecord(e)
	if err != nil {
		return err
	}
	var body struct {
		GiftID string `json:"giftId"`
		Name   string `json:"name"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	name := truncate(body.Name, 60)
	if name == "" {
		return e.BadRequestError("Skriv namnet ditt.", nil)
	}
	gift, err := e.App.FindRecordById("gifts", body.GiftID)
	if err != nil || gift.GetString("list") != list.Id || gift.GetBool("archived") {
		return e.NotFoundError("Fann ikkje gåva.", err)
	}
	year := seasonYear(s.now())
	secret, err := randomToken()
	if err != nil {
		return e.InternalServerError("", err)
	}
	alreadyTaken := false
	// Sjekken og lagringa må skje samla, så to gjester ikkje kan ta same ønske.
	err = e.App.RunInTransaction(func(tx core.App) error {
		if taken(tx, list, gift, year) {
			alreadyTaken = true
			return nil
		}
		col, err := tx.FindCollectionByNameOrId("guest_claims")
		if err != nil {
			return err
		}
		r := core.NewRecord(col)
		r.Set("gift", gift.Id)
		r.Set("name", name)
		r.Set("secret", secret)
		r.Set("year", year)
		return tx.Save(r)
	})
	if err != nil {
		return e.BadRequestError("Kunne ikkje lagre.", err)
	}
	if alreadyTaken {
		return e.Error(http.StatusConflict, "Nokon rakk å ta denne før deg.", nil)
	}
	return e.JSON(http.StatusOK, map[string]string{"claimToken": secret})
}

// sharedImage gjev gjester biletet til ei gåve på lista, sidan filene elles krev innlogging.
func (s *server) sharedImage(e *core.RequestEvent) error {
	list, err := s.sharedRecord(e)
	if err != nil {
		return err
	}
	gift, err := e.App.FindRecordById("gifts", e.Request.PathValue("gift"))
	if err != nil || gift.GetString("list") != list.Id || gift.GetString("image") == "" || gift.GetBool("archived") {
		return e.NotFoundError("Fann ikkje biletet.", err)
	}
	fsys, err := e.App.NewFilesystem()
	if err != nil {
		return e.InternalServerError("", err)
	}
	defer fsys.Close()
	name := gift.GetString("image")
	return fsys.Serve(e.Response, e.Request, gift.BaseFilesPath()+"/"+name, name)
}

func (s *server) sharedUnclaim(e *core.RequestEvent) error {
	if _, err := s.sharedRecord(e); err != nil {
		return err
	}
	var body struct {
		ClaimToken string `json:"claimToken"`
	}
	if err := e.BindBody(&body); err != nil || len(body.ClaimToken) < 32 {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	r, err := e.App.FindFirstRecordByData("guest_claims", "secret", body.ClaimToken)
	if err != nil {
		return e.NotFoundError("Fann ikkje reservasjonen.", err)
	}
	if err := e.App.Delete(r); err != nil {
		return e.InternalServerError("", err)
	}
	return e.NoContent(http.StatusNoContent)
}

// revealYear er jula som kan avslørast no: frå julaften klokka 18 og ut februar.
func revealYear(now time.Time) int {
	switch {
	case now.Month() == time.December && (now.Day() > 24 || (now.Day() == 24 && now.Hour() >= 18)):
		return now.Year()
	case now.Month() <= time.February:
		return now.Year() - 1
	}
	return 0
}
