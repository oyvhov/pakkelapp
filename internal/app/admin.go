package app

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Administrasjon handlar om drift. Her finst det med vilje ingen ruter som les ønske, gåver, lister eller oppgjer.

type appSettings struct {
	FamilyName   string
	HomeRegion   string
	NoAutoPrice  bool
	SignupOpen   bool
	AIEnabled    bool
	AIModel      string
	AIDailyLimit int
	Simplify     bool
}

const defaultRegion = "Vestlandet"

var aiModels = []string{"gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"}

func ensureSettingsRecord(app core.App, model string) error {
	if _, err := app.FindFirstRecordByFilter("app_settings", "id != ''"); err == nil {
		return nil
	}
	col, err := app.FindCollectionByNameOrId("app_settings")
	if err != nil {
		return err
	}
	r := core.NewRecord(col)
	r.Set("family_name", "Storfamilien")
	r.Set("signup_open", true)
	r.Set("ai_enabled", true)
	r.Set("ai_model", model)
	r.Set("ai_daily_limit", 80)
	r.Set("simplify", true)
	return app.Save(r)
}

func (s *server) settings(app core.App) appSettings {
	fallback := appSettings{FamilyName: "Storfamilien", HomeRegion: defaultRegion, SignupOpen: true, AIEnabled: true, AIModel: s.cfg.AIModel, AIDailyLimit: 80, Simplify: true}
	r, err := app.FindFirstRecordByFilter("app_settings", "id != ''")
	if err != nil {
		return fallback
	}
	region := r.GetString("home_region")
	if region == "" {
		region = defaultRegion
	}
	return appSettings{
		FamilyName:   r.GetString("family_name"),
		HomeRegion:   region,
		NoAutoPrice:  r.GetBool("no_auto_price"),
		SignupOpen:   r.GetBool("signup_open"),
		AIEnabled:    r.GetBool("ai_enabled"),
		AIModel:      r.GetString("ai_model"),
		AIDailyLimit: r.GetInt("ai_daily_limit"),
		Simplify:     r.GetBool("simplify"),
	}
}

func requireAdmin(e *core.RequestEvent) error {
	if e.Auth == nil || !e.Auth.GetBool("is_owner") {
		return e.ForbiddenError("Berre for administrator.", nil)
	}
	return e.Next()
}

func (s *server) config(e *core.RequestEvent) error {
	cfg := s.settings(e.App)
	return e.JSON(http.StatusOK, map[string]any{
		"familyName": cfg.FamilyName,
		"aiEnabled":  s.ai.hasKey() && cfg.AIEnabled,
		"simplify":   cfg.Simplify,
		"autoPrice":  s.ai.hasKey() && cfg.AIEnabled && !cfg.NoAutoPrice,
		"season":     seasonYear(s.now()),
	})
}

func (s *server) adminOverview(e *core.RequestEvent) error {
	cfg := s.settings(e.App)
	users, err := e.App.FindAllRecords("users")
	if err != nil {
		return e.InternalServerError("", err)
	}
	type member struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Email    string `json:"email"`
		IsAdmin  bool   `json:"isAdmin"`
		Disabled bool   `json:"disabled"`
		Joined   string `json:"joined"`
	}
	members := make([]member, 0, len(users))
	for _, u := range users {
		members = append(members, member{u.Id, u.GetString("name"), u.Email(), u.GetBool("is_owner"), u.GetBool("disabled"), u.GetDateTime("created").String()})
	}

	backups, last := 0, ""
	if fsys, err := e.App.NewBackupsFilesystem(); err == nil {
		defer fsys.Close()
		if files, err := fsys.List(""); err == nil {
			backups = len(files)
			for _, f := range files {
				if t := f.ModTime.Format("2006-01-02T15:04:05Z07:00"); t > last {
					last = t
				}
			}
		}
	}

	return e.JSON(http.StatusOK, map[string]any{
		"settings": map[string]any{
			"familyName":   cfg.FamilyName,
			"homeRegion":   cfg.HomeRegion,
			"autoPrice":    !cfg.NoAutoPrice,
			"signupOpen":   cfg.SignupOpen,
			"aiEnabled":    cfg.AIEnabled,
			"aiModel":      cfg.AIModel,
			"aiDailyLimit": cfg.AIDailyLimit,
			"simplify":     cfg.Simplify,
		},
		"aiKeySet":     s.ai.hasKey(),
		"aiModels":     aiModels,
		"aiUsageToday": s.ai.totalToday(),
		"members":      members,
		"backups":      map[string]any{"count": backups, "last": last},
		"inviteFixed":  s.cfg.InviteCode != "",
		"inviteUrl":    s.baseURL(e) + "/bli-med/" + s.currentInvite(),
	})
}

func (s *server) adminSaveSettings(e *core.RequestEvent) error {
	var body struct {
		FamilyName   *string `json:"familyName"`
		HomeRegion   *string `json:"homeRegion"`
		AutoPrice    *bool   `json:"autoPrice"`
		SignupOpen   *bool   `json:"signupOpen"`
		AIEnabled    *bool   `json:"aiEnabled"`
		AIModel      *string `json:"aiModel"`
		AIDailyLimit *int    `json:"aiDailyLimit"`
		Simplify     *bool   `json:"simplify"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	r, err := e.App.FindFirstRecordByFilter("app_settings", "id != ''")
	if err != nil {
		return e.InternalServerError("", err)
	}
	if body.FamilyName != nil {
		name := strings.TrimSpace(*body.FamilyName)
		if name == "" {
			return e.BadRequestError("Familien treng eit namn.", nil)
		}
		r.Set("family_name", truncate(name, 80))
	}
	if body.HomeRegion != nil {
		r.Set("home_region", truncate(*body.HomeRegion, 80))
	}
	if body.AutoPrice != nil {
		r.Set("no_auto_price", !*body.AutoPrice)
	}
	if body.SignupOpen != nil {
		r.Set("signup_open", *body.SignupOpen)
	}
	if body.AIEnabled != nil {
		r.Set("ai_enabled", *body.AIEnabled)
	}
	if body.AIModel != nil {
		model := strings.TrimSpace(*body.AIModel)
		if model == "" {
			return e.BadRequestError("Vel ein modell.", nil)
		}
		r.Set("ai_model", truncate(model, 80))
	}
	if body.AIDailyLimit != nil {
		if *body.AIDailyLimit < 1 || *body.AIDailyLimit > 1000 {
			return e.BadRequestError("Grensa må vere mellom 1 og 1000.", nil)
		}
		r.Set("ai_daily_limit", *body.AIDailyLimit)
	}
	if body.Simplify != nil {
		r.Set("simplify", *body.Simplify)
	}
	if err := e.App.Save(r); err != nil {
		return e.BadRequestError("Kunne ikkje lagre.", err)
	}
	return s.adminOverview(e)
}

func (s *server) adminMember(e *core.RequestEvent) error {
	var body struct {
		IsAdmin  *bool `json:"isAdmin"`
		Disabled *bool `json:"disabled"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	user, err := e.App.FindRecordById("users", e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("Fann ikkje brukaren.", err)
	}
	if user.Id == e.Auth.Id && ((body.IsAdmin != nil && !*body.IsAdmin) || (body.Disabled != nil && *body.Disabled)) {
		return e.BadRequestError("Du kan ikkje ta frå deg sjølv tilgangen.", nil)
	}
	if body.IsAdmin != nil {
		user.Set("is_owner", *body.IsAdmin)
	}
	if body.Disabled != nil {
		user.Set("disabled", *body.Disabled)
		if *body.Disabled {
			user.RefreshTokenKey() // Loggar brukaren ut på alle einingar.
		}
	}
	if err := e.App.Save(user); err != nil {
		return e.BadRequestError("Kunne ikkje lagre.", err)
	}
	return s.adminOverview(e)
}

func (s *server) adminRotateInvite(e *core.RequestEvent) error {
	if s.cfg.InviteCode != "" {
		return e.BadRequestError("Koden er sett i serveroppsettet og må endrast der.", nil)
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return e.InternalServerError("", err)
	}
	code := hex.EncodeToString(buf)
	if err := os.WriteFile(filepath.Join(e.App.DataDir(), "invite.txt"), []byte(code), 0o600); err != nil {
		return e.InternalServerError("", err)
	}
	s.setInvite(code)
	return s.adminOverview(e)
}

func (s *server) adminBackup(e *core.RequestEvent) error {
	if err := e.App.CreateBackup(e.Request.Context(), ""); err != nil {
		return e.BadRequestError("Backupen kunne ikkje takast no. Prøv igjen om litt.", err)
	}
	return s.adminOverview(e)
}
