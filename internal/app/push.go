package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

type pusher struct {
	public, private, subject string
	mu                       sync.Mutex
	recent                   map[string]time.Time
}

// loadPusher brukar nøklar som er lagra i datamappa, og lagar dei ved fyrste oppstart.
func loadPusher(dataDir, publicURL string) (*pusher, error) {
	path := filepath.Join(dataDir, "vapid.json")
	var keys struct{ Public, Private string }
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &keys)
	}
	if keys.Public == "" || keys.Private == "" {
		private, public, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			return nil, err
		}
		keys.Public, keys.Private = public, private
		data, _ := json.Marshal(keys)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return nil, err
		}
	}
	subject := publicURL
	if !strings.HasPrefix(subject, "https://") {
		subject = "https://example.com"
	}
	return &pusher{public: keys.Public, private: keys.Private, subject: subject, recent: map[string]time.Time{}}, nil
}

// throttled hindrar at ein familie som legg inn ti ønske på rad, sender ti varsel.
func (p *pusher) throttled(key string, wait time.Duration) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if at, ok := p.recent[key]; ok && time.Since(at) < wait {
		return true
	}
	p.recent[key] = time.Now()
	return false
}

// send legg varselet på alle einingar brukarane har slått på denne typen varsel for.
func (p *pusher) send(app core.App, users []string, kind, title, body, url string) {
	p.deliver(app, users, kind, title, body, url)
}

// pushReport fortel kva som skjedde med eit varsel, så administrator kan teste.
type pushReport struct {
	Sent   int      `json:"sent"`
	Gone   int      `json:"gone"`
	Errors []string `json:"errors"`
}

func (p *pusher) deliver(app core.App, users []string, kind, title, body, url string) pushReport {
	report := pushReport{Errors: []string{}}
	if p == nil {
		return report
	}
	payload, _ := json.Marshal(map[string]string{"title": title, "body": body, "url": url})
	for _, user := range uniqueStrings(users) {
		subs, err := app.FindAllRecords("push_subs", dbx.HashExp{"user": user, kind: true})
		if err != nil {
			continue
		}
		for _, sub := range subs {
			res, err := webpush.SendNotification(payload, &webpush.Subscription{
				Endpoint: sub.GetString("endpoint"),
				Keys:     webpush.Keys{P256dh: sub.GetString("p256dh"), Auth: sub.GetString("auth")},
			}, &webpush.Options{HTTPClient: &http.Client{Timeout: 15 * time.Second}, Subscriber: p.subject, VAPIDPublicKey: p.public, VAPIDPrivateKey: p.private, TTL: 86400})
			if err != nil {
				log.Printf("varsel: %v", err)
				report.Errors = append(report.Errors, err.Error())
				continue
			}
			_, _ = io.Copy(io.Discard, res.Body)
			res.Body.Close()
			switch {
			case res.StatusCode == http.StatusGone || res.StatusCode == http.StatusNotFound:
				_ = app.Delete(sub) // Eininga har slått av varsel.
				report.Gone++
			case res.StatusCode >= 300:
				report.Errors = append(report.Errors, fmt.Sprintf("varseltenesta svarte %d", res.StatusCode))
			default:
				report.Sent++
			}
		}
	}
	return report
}

func (s *server) pushKey(e *core.RequestEvent) error {
	if s.push == nil {
		return e.Error(http.StatusServiceUnavailable, "Varsel er ikkje tilgjengeleg.", nil)
	}
	return e.JSON(http.StatusOK, map[string]string{"key": s.push.public})
}

func firstWord(s string) string {
	if f := strings.Fields(s); len(f) > 0 {
		return f[0]
	}
	return s
}

// validPushEndpoint godtek berre dei kjende varseltenestene, så serveren aldri kan bli bedt om å kontakte andre adresser.
func validPushEndpoint(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "fcm.googleapis.com" || host == "web.push.apple.com" {
		return true
	}
	for _, suffix := range []string{".push.apple.com", ".notify.windows.com", ".push.services.mozilla.com"} {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func (s *server) registerNotify(pb *pocketbase.PocketBase) {
	checkEndpoint := func(e *core.RecordEvent) error {
		if !validPushEndpoint(e.Record.GetString("endpoint")) {
			return invalid("endpoint", "Denne varseltenesta er ikkje støtta.")
		}
		return e.Next()
	}
	pb.OnRecordCreate("push_subs").BindFunc(checkEndpoint)
	pb.OnRecordUpdate("push_subs").BindFunc(checkEndpoint)

	// Den som får eit ønske delt med seg, får beskjed.
	pb.OnRecordAfterUpdateSuccess("gifts").BindFunc(func(e *core.RecordEvent) error {
		before := map[string]bool{}
		for _, u := range e.Record.Original().GetStringSlice("shared_with") {
			before[u] = true
		}
		var added []string
		for _, u := range e.Record.GetStringSlice("shared_with") {
			if !before[u] {
				added = append(added, u)
			}
		}
		if len(added) > 0 {
			gift := e.Record
			go func() {
				list, err := pb.FindRecordById("lists", gift.GetString("list"))
				if err != nil {
					return
				}
				owner, err := pb.FindRecordById("users", list.GetString("owner"))
				if err != nil {
					return
				}
				url := "/"
				if p := list.GetString("person"); p != "" {
					url = "/folk/" + p
				}
				s.push.send(pb, added, "wishes", fmt.Sprintf("%s delte eit ønske med deg", firstWord(owner.GetString("name"))), gift.GetString("title"), url)
			}()
		}
		return e.Next()
	})

	// Nye ønske går til dei som har personen på lista si.
	pb.OnRecordAfterCreateSuccess("gifts").BindFunc(func(e *core.RecordEvent) error {
		gift := e.Record
		go func() {
			list, err := pb.FindRecordById("lists", gift.GetString("list"))
			if err != nil || list.GetString("kind") != "wishes" || list.GetString("visibility") == "private" {
				return
			}
			person, err := pb.FindRecordById("people", list.GetString("person"))
			if err != nil {
				return
			}
			marks, _ := pb.FindAllRecords("recipients", dbx.HashExp{"person": person.Id, "year": seasonYear(s.now())})
			allowed := map[string]bool{}
			for _, id := range append(list.GetStringSlice("editors"), list.GetStringSlice("viewers")...) {
				allowed[id] = true
			}
			var users []string
			for _, m := range marks {
				u := m.GetString("user")
				if u == gift.GetString("created_by") || u == person.GetString("user") {
					continue
				}
				if list.GetString("visibility") == "shared" && !allowed[u] && u != list.GetString("owner") {
					continue
				}
				if !s.push.throttled("wish:"+u+":"+person.Id, 30*time.Minute) {
					users = append(users, u)
				}
			}
			s.push.send(pb, users, "wishes", fmt.Sprintf("Nytt ønske frå %s", firstWord(person.GetString("name"))), gift.GetString("title"), "/folk/"+person.Id)
		}()
		return e.Next()
	})

	// Den som blir lagd til som givar, får vite det. Teksten nemner ikkje gåva, for varselet kan bli lese av andre.
	notifyGivers := func(gift *core.Record, before []string) {
		had := map[string]bool{}
		for _, id := range before {
			had[id] = true
		}
		var added []string
		for _, id := range gift.GetStringSlice("givers") {
			if !had[id] {
				added = append(added, id)
			}
		}
		if len(added) == 0 {
			return
		}
		go func() {
			if list, err := pb.FindRecordById("lists", gift.GetString("list")); err != nil || list.GetString("kind") != "plan" {
				return
			}
			receiving := map[string]bool{}
			for _, id := range gift.GetStringSlice("recipients") {
				if p, err := pb.FindRecordById("people", id); err == nil && p.GetString("user") != "" {
					receiving[p.GetString("user")] = true
				}
			}
			by := ""
			if u, err := pb.FindRecordById("users", gift.GetString("created_by")); err == nil {
				by = firstWord(u.GetString("name"))
			}
			var users []string
			for _, id := range added {
				p, err := pb.FindRecordById("people", id)
				if err != nil {
					continue
				}
				u := p.GetString("user")
				if u == "" || u == gift.GetString("created_by") || receiving[u] || s.push.throttled("giver:"+u+":"+gift.Id, time.Hour) {
					continue
				}
				users = append(users, u)
			}
			url := "/"
			if r := gift.GetStringSlice("recipients"); len(r) > 0 {
				url = "/folk/" + r[0]
			}
			s.push.send(pb, users, "payments", "Ny felles gåve", fmt.Sprintf("%s har lagt deg til som givar på ei gåve.", by), url)
		}()
	}
	pb.OnRecordAfterCreateSuccess("gifts").BindFunc(func(e *core.RecordEvent) error {
		notifyGivers(e.Record, nil)
		return e.Next()
	})
	pb.OnRecordAfterUpdateSuccess("gifts").BindFunc(func(e *core.RecordEvent) error {
		notifyGivers(e.Record, e.Record.Original().GetStringSlice("givers"))
		return e.Next()
	})

	// Ny melding i hemmeleg prat går til dei andre som er med på gåva. Aldri til den som skal få ho.
	pb.OnRecordAfterCreateSuccess("comments").BindFunc(func(e *core.RecordEvent) error {
		comment := e.Record
		go func() {
			gift, err := pb.FindRecordById("gifts", comment.GetString("gift"))
			if err != nil {
				return
			}
			list, err := pb.FindRecordById("lists", gift.GetString("list"))
			if err != nil {
				return
			}
			userOf := func(personID string) string {
				if p, err := pb.FindRecordById("people", personID); err == nil {
					return p.GetString("user")
				}
				return ""
			}
			wisher := ""
			if list.GetString("kind") == "wishes" {
				wisher = userOf(list.GetString("person"))
			}
			var receivers, givers, claimers, earlier []string
			for _, id := range gift.GetStringSlice("recipients") {
				receivers = append(receivers, userOf(id))
			}
			for _, id := range gift.GetStringSlice("givers") {
				givers = append(givers, userOf(id))
			}
			claims, _ := pb.FindAllRecords("claims", dbx.HashExp{"gift": gift.Id})
			for _, c := range claims {
				claimers = append(claimers, c.GetString("user"))
			}
			before, _ := pb.FindAllRecords("comments", dbx.HashExp{"gift": gift.Id})
			for _, c := range before {
				earlier = append(earlier, c.GetString("user"))
			}
			author := comment.GetString("user")
			users := chatAudience(chatThread{
				Wish: list.GetString("kind") == "wishes", Author: author, Owner: list.GetString("owner"), Creator: gift.GetString("created_by"),
				Wisher: wisher, Receivers: receivers, Givers: givers, Claimers: claimers, Earlier: earlier,
			})
			var send []string
			for _, u := range users {
				if !s.push.throttled("chat:"+u+":"+gift.Id, 10*time.Minute) {
					send = append(send, u)
				}
			}
			name := ""
			if u, err := pb.FindRecordById("users", author); err == nil {
				name = firstWord(u.GetString("name"))
			}
			url := "/"
			if r := gift.GetStringSlice("recipients"); len(r) > 0 {
				url = "/folk/" + r[0]
			} else if p := list.GetString("person"); p != "" {
				url = "/folk/" + p
			}
			s.push.send(pb, send, "chat", "Hemmeleg prat", fmt.Sprintf("%s skreiv ei melding om ei gåve.", name), url)
		}()
		return e.Next()
	})

	pb.OnRecordAfterCreateSuccess("settlements").BindFunc(func(e *core.RecordEvent) error {
		r := e.Record
		if r.GetString("status") == "pending" {
			go func() {
				name := ""
				if p, err := pb.FindRecordById("people", r.GetString("from_person")); err == nil {
					name = firstWord(p.GetString("name"))
				}
				s.push.send(pb, r.GetStringSlice("receivers"), "payments", "Betaling ventar på deg", fmt.Sprintf("%s seier %s er betalt.", name, formatOre(int64(r.GetInt("amount")))), "/oppgjer")
			}()
		}
		return e.Next()
	})

	pb.OnRecordAfterCreateSuccess("expenses").BindFunc(func(e *core.RecordEvent) error {
		r := e.Record
		go func() {
			creator := ""
			if u, err := pb.FindRecordById("users", r.GetString("created_by")); err == nil {
				creator = firstWord(u.GetString("name"))
			}
			var users []string
			for _, u := range r.GetStringSlice("visible_to") {
				if u != r.GetString("created_by") {
					users = append(users, u)
				}
			}
			// Teksten nemner aldri gåva, for varselet kan bli lese av andre.
			s.push.send(pb, users, "payments", "Nytt utlegg", fmt.Sprintf("%s la inn eit utlegg på %s.", creator, formatOre(int64(r.GetInt("amount")))), "/oppgjer")
		}()
		return e.Next()
	})

	pb.OnRecordAfterUpdateSuccess("people").BindFunc(func(e *core.RecordEvent) error {
		r := e.Record
		target := r.GetString("covered_request")
		if target != "" && target != r.Original().GetString("covered_request") {
			go func() {
				by := r.GetString("covered_request_by")
				var users []string
				if u := r.GetString("user"); u != "" && u != by {
					users = append(users, u)
				}
				if p, err := pb.FindRecordById("people", target); err == nil && p.GetString("user") != by {
					users = append(users, p.GetString("user"))
				}
				s.push.send(pb, users, "payments", "Felles økonomi", "Nokon vil samle økonomien med deg. Svar under Oppgjer.", "/oppgjer")
			}()
		}
		return e.Next()
	})
}

// sendReminders går éin gong om dagen og minner om jul og andre høve.
func (s *server) sendReminders(app core.App) {
	now := s.now()
	eve := time.Date(seasonYear(now), time.December, 24, 0, 0, 0, 0, now.Location())
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	days := int(eve.Sub(today).Hours() / 24)
	switch days {
	case 28, 21, 14, 7, 3, 1:
		s.remindChristmas(app, days)
	}
	lists, _ := app.FindRecordsByFilter("lists", `occasion != "" && occasion != "jul" && event_date != ""`, "", 0, 0)
	for _, list := range lists {
		date, err := time.ParseInLocation("2006-01-02", list.GetString("event_date"), now.Location())
		if err != nil {
			continue
		}
		left := int(date.Sub(today).Hours() / 24)
		if left != 14 && left != 3 {
			continue
		}
		users := append([]string{list.GetString("owner")}, list.GetStringSlice("editors")...)
		users = append(users, list.GetStringSlice("viewers")...)
		s.push.send(app, users, "reminders", list.GetString("name"), fmt.Sprintf("Om %d dagar.", left), "/lister/"+list.Id)
	}
}

func (s *server) remindChristmas(app core.App, days int) {
	for user, n := range s.missingGifts(app, "") {
		title, body := christmasReminder(days, n)
		s.push.send(app, []string{user}, "reminders", title, body, "/")
	}
}

// christmasReminder er teksten i påminninga før jul.
func christmasReminder(days, missing int) (title, body string) {
	title = fmt.Sprintf("%d dagar til julaften", days)
	if days == 1 {
		title = "I morgon er det julaften"
	}
	body = fmt.Sprintf("%d personar manglar gåve frå deg.", missing)
	if missing == 1 {
		body = "1 person manglar gåve frå deg."
	}
	return title, body
}

// missingGifts tel kor mange kvar brukar manglar gåve til. Med only blir berre den brukaren rekna.
func (s *server) missingGifts(app core.App, only string) map[string]int {
	season := seasonYear(s.now())
	filter := dbx.HashExp{"year": season}
	if only != "" {
		filter["user"] = only
	}
	marks, _ := app.FindAllRecords("recipients", filter)
	missing := map[string]int{}
	f, err := loadFamily(app)
	if err != nil {
		return missing
	}
	for _, m := range marks {
		if m.GetBool("done") {
			continue // Brukaren har sagt seg ferdig, og skal ikkje bli mast på.
		}
		user, person := m.GetString("user"), m.GetString("person")
		mine := f.byUser[user]
		planned, _ := app.FindRecordsByFilter("gifts", `recipients.id ?= {:p} && list.kind = "plan" && list.year = {:y} && (givers.id ?= {:me} || created_by = {:u})`, "", 1, 0, dbx.Params{"p": person, "y": season, "me": mine, "u": user})
		claimed, _ := app.FindRecordsByFilter("claims", `user = {:u} && year = {:y} && gift.list.person = {:p}`, "", 1, 0, dbx.Params{"u": user, "y": season, "p": person})
		if len(planned) == 0 && len(claimed) == 0 {
			missing[user]++
		}
	}
	return missing
}

// checkWatchedPrices sjekkar gåver brukarane følgjer, og varslar om prisfall.
func (s *server) checkWatchedPrices(app core.App) {
	cfg := s.settings(app)
	if !s.ai.hasKey() || !cfg.AIEnabled {
		return
	}
	gifts, err := app.FindRecordsByFilter("gifts", `watch_price = true && archived = false && (status = "" || status = "idea")`, "", 40, 0)
	if err != nil {
		return
	}
	f, err := loadFamily(app)
	if err != nil {
		return
	}
	for _, g := range gifts {
		ctx, cancel := context.WithTimeout(context.Background(), 170*time.Second)
		offers, _, err := s.checkPrices(ctx, cfg, g.GetString("title"), g.GetString("url"))
		cancel()
		if err != nil {
			log.Printf("prisvakt: %v", err)
			continue
		}
		fresh, err := app.FindRecordById("gifts", g.Id)
		if err != nil || fresh.GetString("title") != g.GetString("title") || fresh.GetString("url") != g.GetString("url") {
			continue // Gåva er endra medan sjekken gjekk.
		}
		g = fresh
		before := g.GetFloat("best_price")
		if before == 0 {
			before = g.GetFloat("price")
		}
		applyOffers(g, offers)
		if err := app.Save(g); err != nil {
			continue
		}
		after := g.GetFloat("best_price")
		if after > 0 && before > 0 && after <= before-10 {
			users := []string{g.GetString("created_by")}
			users = append(users, f.usersFor(g.GetStringSlice("givers")...)...)
			hidden := map[string]bool{}
			for _, id := range g.GetStringSlice("recipients") {
				if p := f.people[id]; p != nil {
					hidden[p.GetString("user")] = true
				}
			}
			var allowed []string
			for _, u := range users {
				if !hidden[u] {
					allowed = append(allowed, u)
				}
			}
			s.push.send(app, allowed, "prices", "Prisen har gått ned", fmt.Sprintf("%s: %.0f kr hos %s", g.GetString("title"), after, g.GetString("best_shop")), "/lister/"+g.GetString("list"))
		}
	}
}

// shareGift gjev dei andre givarane beskjed om ei gåve. Berre den som sjølv er med på gåva, eller eig lista, kan dele.
func (s *server) shareGift(e *core.RequestEvent) error {
	gift, err := e.App.FindRecordById("gifts", e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("Fann ikkje gåva.", err)
	}
	list, err := e.App.FindRecordById("lists", gift.GetString("list"))
	if err != nil || list.GetString("kind") != "plan" {
		return e.BadRequestError("Berre planlagde gåver kan delast.", nil)
	}
	userOf := func(personID string) string {
		if p, err := e.App.FindRecordById("people", personID); err == nil {
			return p.GetString("user")
		}
		return ""
	}
	actor := e.Auth.Id
	allowed := list.GetString("owner") == actor || gift.GetString("created_by") == actor
	for _, id := range gift.GetStringSlice("givers") {
		if userOf(id) == actor {
			allowed = true
		}
	}
	if !allowed {
		return e.ForbiddenError("Du er ikkje med på denne gåva.", nil)
	}
	receiving := map[string]bool{}
	for _, id := range gift.GetStringSlice("recipients") {
		if u := userOf(id); u != "" {
			receiving[u] = true
		}
	}
	var users []string
	for _, id := range gift.GetStringSlice("givers") {
		if u := userOf(id); u != "" && u != actor && !receiving[u] {
			users = append(users, u)
		}
	}
	if len(users) == 0 {
		return e.BadRequestError("Ingen andre givarar er i appen.", nil)
	}
	if s.push.throttled("share:"+actor+":"+gift.Id, 2*time.Minute) {
		return e.TooManyRequestsError("Beskjeden er alt sendt. Vent litt før du sender igjen.", nil)
	}
	url := "/"
	if r := gift.GetStringSlice("recipients"); len(r) > 0 {
		url = "/folk/" + r[0]
	}
	name := firstWord(e.Auth.GetString("name"))
	go s.push.send(e.App, users, "payments", "Felles gåve", fmt.Sprintf("%s vil at du skal sjå på ei gåve de gjev saman.", name), url)
	return e.JSON(http.StatusOK, map[string]any{"sent": len(users)})
}

// chatThread er det som avgjer kven som får varsel om ei ny melding. Alle felt er brukar-id-ar.
type chatThread struct {
	Wish                                 bool
	Author, Owner, Creator, Wisher       string
	Receivers, Givers, Claimers, Earlier []string
}

// chatAudience vel kven som får varsel: dei som er med på gåva og dei som alt har skrive.
// Den som skreiv, den som skal få gåva og den som ønskte seg ho, får aldri varsel.
func chatAudience(t chatThread) []string {
	blocked := map[string]bool{"": true, t.Author: true, t.Wisher: true}
	for _, u := range t.Receivers {
		blocked[u] = true
	}
	var out []string
	add := func(users ...string) {
		for _, u := range users {
			if !blocked[u] {
				blocked[u] = true
				out = append(out, u)
			}
		}
	}
	if t.Wish {
		add(t.Claimers...)
	} else {
		add(t.Owner, t.Creator)
		add(t.Givers...)
	}
	add(t.Earlier...)
	return out
}
