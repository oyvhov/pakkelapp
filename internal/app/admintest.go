package app

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Testverktøy for administrator. Alt går berre til administrator sjølv, og les ingenting om andre.

var pushKinds = []string{"wishes", "payments", "chat", "reminders", "prices"}

var testMessages = map[string][2]string{
	"wishes":    {"Nytt ønske frå Testperson", "Ullsokkar i str. 42"},
	"payments":  {"Testperson har betalt deg", "250 kr for felles gåve"},
	"chat":      {"Ny melding om ei gåve", "Testperson: Skal vi spleise?"},
	"reminders": {"7 dagar til julaften", "2 personar manglar gåve frå deg."},
	"prices":    {"Prisfall på ei gåve du følgjer", "Ullpledd: no 1 499 kr, før 1 999 kr"},
}

type testDevice struct {
	ID      string          `json:"id"`
	Service string          `json:"service"`
	Created string          `json:"created"`
	Kinds   map[string]bool `json:"kinds"`
}

func (s *server) adminTestStatus(e *core.RequestEvent) error {
	subs, _ := e.App.FindAllRecords("push_subs", dbx.HashExp{"user": e.Auth.Id})
	devices := make([]testDevice, 0, len(subs))
	for _, sub := range subs {
		d := testDevice{ID: sub.Id, Created: sub.GetString("created"), Kinds: map[string]bool{}}
		if u, err := url.Parse(sub.GetString("endpoint")); err == nil {
			d.Service = u.Hostname()
		}
		for _, k := range pushKinds {
			d.Kinds[k] = sub.GetBool(k)
		}
		devices = append(devices, d)
	}
	cfg := s.settings(e.App)
	return e.JSON(http.StatusOK, map[string]any{
		"pushReady":  s.push != nil,
		"devices":    devices,
		"aiReady":    s.ai.hasKey() && cfg.AIEnabled,
		"aiModel":    cfg.AIModel,
		"serverTime": s.now().Format(time.RFC3339),
		"jul":        isJulDate(s.now()),
	})
}

func (s *server) adminTestPush(e *core.RequestEvent) error {
	var body struct {
		Kind string `json:"kind"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	msg, ok := testMessages[body.Kind]
	if !ok {
		return e.BadRequestError("Ukjend varseltype.", nil)
	}
	if s.push == nil {
		return e.Error(http.StatusServiceUnavailable, "Varsel er ikkje tilgjengeleg på serveren.", nil)
	}
	report := s.push.deliver(e.App, []string{e.Auth.Id}, body.Kind, "Test: "+msg[0], msg[1], "/admin")
	all, _ := e.App.FindAllRecords("push_subs", dbx.HashExp{"user": e.Auth.Id})
	return e.JSON(http.StatusOK, map[string]any{"report": report, "devices": len(all)})
}

// adminTestReminder sender den ekte påminninga før jul, rekna ut frå administrator sine eigne val.
func (s *server) adminTestReminder(e *core.RequestEvent) error {
	if s.push == nil {
		return e.Error(http.StatusServiceUnavailable, "Varsel er ikkje tilgjengeleg på serveren.", nil)
	}
	now := s.now()
	eve := time.Date(seasonYear(now), time.December, 24, 0, 0, 0, 0, now.Location())
	days := int(time.Until(eve).Hours()/24) + 1
	if days < 1 || days > 60 {
		days = 7
	}
	missing := s.missingGifts(e.App, e.Auth.Id)[e.Auth.Id]
	title, text := christmasReminder(days, missing)
	if missing == 0 {
		text = "Du har gåve til alle du har valt. Då får du ikkje denne påminninga."
	}
	report := s.push.deliver(e.App, []string{e.Auth.Id}, "reminders", "Test: "+title, text, "/")
	return e.JSON(http.StatusOK, map[string]any{"report": report, "title": title, "body": text, "missing": missing})
}

// adminTestNisse sjekkar at Nissen får kontakt, med ein liten og billeg førespurnad.
func (s *server) adminTestNisse(e *core.RequestEvent) error {
	cfg, err := s.aiReady(e)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(e.Request.Context(), 60*time.Second)
	defer cancel()
	start := time.Now()
	res, err := s.ai.respond(ctx, aiRequest{
		Model:        cfg.AIModel,
		Instructions: "Svar med eitt kort ord på nynorsk.",
		Input:        []chatMessage{{"user", "Seie hei."}},
		MaxTokens:    200,
	})
	ms := time.Since(start).Milliseconds()
	if err != nil {
		return e.JSON(http.StatusOK, map[string]any{"ok": false, "ms": ms, "model": cfg.AIModel, "error": fmt.Sprint(err)})
	}
	return e.JSON(http.StatusOK, map[string]any{"ok": true, "ms": ms, "model": cfg.AIModel, "reply": truncate(res.Text, 200)})
}
