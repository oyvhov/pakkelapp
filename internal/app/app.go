// Package app inneheld serverdelen av Pakkelapp: skjema, API-ruter, lenkehenting og Nissen.
package app

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type Config struct {
	PublicURL   string
	InviteCode  string
	EnableAdmin bool
	AIModel     string
	AIKey       string
	AIBaseURL   string
	TestNow     string
	Assets      fs.FS
}

type server struct {
	cfg      Config
	inviteMu sync.RWMutex
	invite   string
	ai       *nisse
	push     *pusher
}

// now er vanlegvis klokka no. JUL_TEST_NOW lèt testar sjå korleis appen er etter julaften.
func (s *server) now() time.Time {
	if t, err := time.Parse(time.RFC3339, s.cfg.TestNow); err == nil {
		return t
	}
	return time.Now()
}

func (s *server) currentInvite() string {
	s.inviteMu.RLock()
	defer s.inviteMu.RUnlock()
	return s.invite
}

func (s *server) setInvite(code string) {
	s.inviteMu.Lock()
	defer s.inviteMu.Unlock()
	s.invite = code
}

func Register(pb *pocketbase.PocketBase, cfg Config) {
	s := &server{cfg: cfg, ai: newNisse(cfg)}
	registerLedgerHooks(pb)
	s.registerNotify(pb)

	pb.OnRecordAuthRequest("users").BindFunc(func(e *core.RecordAuthRequestEvent) error {
		if e.Record.GetBool("disabled") {
			return e.ForbiddenError("Kontoen er sett på pause. Snakk med administrator.", nil)
		}
		return e.Next()
	})

	pb.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := ensureSchema(se.App); err != nil {
			return err
		}
		if err := ensureSettingsRecord(se.App, cfg.AIModel); err != nil {
			return err
		}
		if err := applySettings(se.App, cfg); err != nil {
			return err
		}
		invite, err := loadInvite(se.App.DataDir(), cfg.InviteCode)
		if err != nil {
			return err
		}
		s.setInvite(invite)
		if s.push, err = loadPusher(se.App.DataDir(), cfg.PublicURL); err != nil {
			log.Printf("varsel er av: %v", err)
		}
		se.App.Cron().SetTimezone(time.Local)
		se.App.Cron().MustAdd("jul-paaminning", "0 10 * * *", func() { s.sendReminders(pb) })
		se.App.Cron().MustAdd("jul-prisvakt", "30 9 * * 1", func() { s.checkWatchedPrices(pb) })
		if n, _ := se.App.CountRecords("users"); n == 0 {
			log.Printf("Fyrste brukar blir eigar. Invitasjonslenke: %s/bli-med/%s", s.baseURL(nil), invite)
		}

		se.Router.BindFunc(s.securityHeaders)

		g := se.Router.Group("/api/jul")
		g.GET("/invite/{code}", s.inviteInfo)
		g.POST("/register", s.register)
		g.GET("/shared/{token}", s.sharedList)
		g.GET("/shared/{token}/image/{gift}", s.sharedImage)
		g.POST("/shared/{token}/claim", s.sharedClaim)
		g.POST("/shared/{token}/unclaim", s.sharedUnclaim)

		private := se.Router.Group("/api/jul")
		private.Bind(apis.RequireAuth("users"))
		private.GET("/config", s.config)
		private.GET("/invite-link", s.inviteLink)
		private.POST("/preview", s.preview)
		private.GET("/image", s.image)
		private.POST("/ai/chat", s.aiChat)
		private.POST("/ai/rhyme", s.aiRhyme)
		private.POST("/ai/best-price", s.bestPrice)
		private.POST("/ai/gift-price/{id}", s.giftPriceCheck)
		private.GET("/settle", s.settle)
		private.POST("/settle/preview", s.settlePreview)
		private.POST("/expenses/{id}/dispute", s.dispute)
		private.POST("/covered-by", s.setCoveredBy)
		private.POST("/gifts/{id}/share", s.shareGift)
		private.POST("/lists/{id}/share", s.setShare)
		private.GET("/push/key", s.pushKey)
		private.GET("/received", s.received)
		private.POST("/received/archive", s.archiveReceived)

		admin := se.Router.Group("/api/jul/admin")
		admin.Bind(apis.RequireAuth("users"))
		admin.BindFunc(requireAdmin)
		admin.GET("", s.adminOverview)
		admin.PATCH("/settings", s.adminSaveSettings)
		admin.PATCH("/members/{id}", s.adminMember)
		admin.POST("/reset-link", s.resetLink)
		admin.POST("/invite/rotate", s.adminRotateInvite)
		admin.POST("/backup", s.adminBackup)

		for _, name := range seasonAssets {
			se.Router.GET("/"+name, s.seasonAsset(name))
		}
		se.Router.GET("/{path...}", apis.Static(cfg.Assets, true))
		return se.Next()
	})
}

func (s *server) securityHeaders(e *core.RequestEvent) error {
	path := e.Request.URL.Path
	if !s.cfg.EnableAdmin && (path == "/_" || strings.HasPrefix(path, "/_/")) {
		return e.NotFoundError("", nil)
	}
	h := e.Response.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
	if !strings.HasPrefix(path, "/_/") {
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
	}
	if path == "/manifest.webmanifest" {
		h.Set("Content-Type", "application/manifest+json")
	}
	switch {
	case strings.HasPrefix(path, "/assets/"):
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	case !strings.HasPrefix(path, "/api/"):
		h.Set("Cache-Control", "no-cache")
	}
	return e.Next()
}

func (s *server) baseURL(e *core.RequestEvent) string {
	if s.cfg.PublicURL != "" {
		return s.cfg.PublicURL
	}
	if e == nil {
		return "http://localhost:8430"
	}
	scheme := "http"
	if e.IsTLS() || e.Request.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + e.Request.Host
}

// loadInvite brukar JUL_INVITE_CODE om han er sett, elles ein tilfeldig kode som blir lagra i datamappa.
func loadInvite(dataDir, configured string) (string, error) {
	if configured != "" {
		return configured, nil
	}
	path := filepath.Join(dataDir, "invite.txt")
	if b, err := os.ReadFile(path); err == nil && strings.TrimSpace(string(b)) != "" {
		return strings.TrimSpace(string(b)), nil
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	code := hex.EncodeToString(buf)
	return code, os.WriteFile(path, []byte(code), 0o600)
}

func (s *server) validInvite(code string) bool {
	return subtle.ConstantTimeCompare([]byte(strings.TrimSpace(code)), []byte(s.currentInvite())) == 1
}

func (s *server) inviteInfo(e *core.RequestEvent) error {
	if !s.validInvite(e.Request.PathValue("code")) || !s.settings(e.App).SignupOpen {
		return e.ForbiddenError("Invitasjonen er ikkje gyldig.", nil)
	}
	people, err := e.App.FindRecordsByFilter("people", `user = ""`, "name", 200, 0)
	if err != nil {
		return e.InternalServerError("", err)
	}
	type row struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Relation string `json:"relation"`
	}
	out := make([]row, 0, len(people))
	for _, p := range people {
		out = append(out, row{p.Id, p.GetString("name"), p.GetString("relation")})
	}
	return e.JSON(http.StatusOK, map[string]any{"people": out})
}

func seasonYear(now time.Time) int {
	if now.Month() == time.December && now.Day() > 26 {
		return now.Year() + 1
	}
	return now.Year()
}

var palette = []string{"#a8233b", "#24524a", "#b88a35", "#5a4a8c", "#2b6f8f", "#b5562b", "#6b7a2f", "#8c3f6b"}

func (s *server) register(e *core.RequestEvent) error {
	var body struct {
		Code     string `json:"code"`
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		PersonID string `json:"personId"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	if !s.validInvite(body.Code) || !s.settings(e.App).SignupOpen {
		return e.ForbiddenError("Invitasjonen er ikkje gyldig.", nil)
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" || len(body.Password) < 8 {
		return e.BadRequestError("Skriv namn og eit passord på minst 8 teikn.", nil)
	}

	var user *core.Record
	err := e.App.RunInTransaction(func(tx core.App) error {
		users, err := tx.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		count, err := tx.CountRecords("users")
		if err != nil {
			return err
		}
		user = core.NewRecord(users)
		user.SetEmail(strings.ToLower(strings.TrimSpace(body.Email)))
		user.SetPassword(body.Password)
		user.SetVerified(true)
		user.Set("name", body.Name)
		user.Set("is_owner", count == 0)
		color := palette[int(count)%len(palette)]
		user.Set("color", color)
		if err := tx.Save(user); err != nil {
			return err
		}

		var person *core.Record
		if body.PersonID != "" {
			person, err = tx.FindFirstRecordByFilter("people", `id = {:id} && user = ""`, dbx.Params{"id": body.PersonID})
			if err != nil {
				return errors.New("personen er alt knytt til ein konto")
			}
		} else {
			peopleCol, err := tx.FindCollectionByNameOrId("people")
			if err != nil {
				return err
			}
			person = core.NewRecord(peopleCol)
			person.Set("name", body.Name)
			person.Set("color", color)
			person.Set("created_by", user.Id)
		}
		// Ein som får eigen konto, styrer sin eigen økonomi frå no av. Gamle utlegg står urørte.
		person.Set("covered_by", "")
		person.Set("user", user.Id)
		if err := tx.Save(person); err != nil {
			return err
		}

		listsCol, err := tx.FindCollectionByNameOrId("lists")
		if err != nil {
			return err
		}
		wishes := core.NewRecord(listsCol)
		wishes.Set("name", "Ønska mine")
		wishes.Set("kind", "wishes")
		wishes.Set("visibility", "family")
		wishes.Set("owner", user.Id)
		wishes.Set("person", person.Id)
		wishes.Set("year", seasonYear(time.Now()))
		if err := tx.Save(wishes); err != nil {
			return err
		}
		plan := core.NewRecord(listsCol)
		plan.Set("name", "Gåveplanen min")
		plan.Set("kind", "plan")
		plan.Set("visibility", "private")
		plan.Set("owner", user.Id)
		plan.Set("year", seasonYear(time.Now()))
		return tx.Save(plan)
	})
	if err != nil {
		return e.BadRequestError("Kunne ikkje opprette kontoen. Kanskje e-posten alt er i bruk?", err)
	}
	return apis.RecordAuthResponse(e, user, "password", nil)
}

func (s *server) inviteLink(e *core.RequestEvent) error {
	return e.JSON(http.StatusOK, map[string]string{"url": s.baseURL(e) + "/bli-med/" + s.currentInvite()})
}

// resetLink lèt administrator lage ei lenke for nytt passord, sidan appen ikkje treng e-postteneste.
func (s *server) resetLink(e *core.RequestEvent) error {
	var body struct {
		UserID string `json:"userId"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	user, err := e.App.FindRecordById("users", body.UserID)
	if err != nil {
		return e.NotFoundError("Fann ikkje brukaren.", err)
	}
	token, err := user.NewPasswordResetToken()
	if err != nil {
		return e.InternalServerError("", err)
	}
	// Vedkomande skal få vite at det er laga ei slik lenke, så ingen kan gå inn i kontoen i det stille.
	user.Set("password_reset_at", time.Now().Format(time.RFC3339))
	if err := e.App.Save(user); err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]string{"url": s.baseURL(e) + "/nytt-passord/" + token})
}
