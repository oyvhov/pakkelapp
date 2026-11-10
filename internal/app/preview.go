package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/net/html"
)

const (
	maxPageBytes  = 3 << 20
	maxImageBytes = 8 << 20
	userAgent     = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0 Safari/537.36 TilOgFra/1.0"
)

var errBlockedHost = errors.New("adressa er ikkje offentleg")

var blockedNets = func() []*net.IPNet {
	var out []*net.IPNet
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.88.99.0/24", "198.18.0.0/15", "240.0.0.0/4", "64:ff9b::/96", "2001:db8::/32", "100::/64"} {
		_, n, _ := net.ParseCIDR(cidr)
		out = append(out, n)
	}
	return out
}()

func isPublicIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	for _, n := range blockedNets {
		if n.Contains(ip) {
			return false
		}
	}
	return true
}

// safeClient kontrollerer den faktiske IP-adressa etter DNS-oppslag, så ei brukarlenke ikkje kan nå interne tenester.
var safeClient = &http.Client{
	Timeout: 12 * time.Second,
	Transport: &http.Transport{
		Proxy: nil,
		DialContext: (&net.Dialer{
			Timeout: 6 * time.Second,
			Control: func(_, address string, _ syscall.RawConn) error {
				host, port, err := net.SplitHostPort(address)
				if err != nil {
					return err
				}
				if (port != "80" && port != "443") || !isPublicIP(net.ParseIP(host)) {
					return errBlockedHost
				}
				return nil
			},
		}).DialContext,
		TLSHandshakeTimeout:   6 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("for mange omdirigeringar")
		}
		return checkURL(req.URL)
	},
}

func checkURL(u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("berre http og https er støtta")
	}
	if u.Hostname() == "" || u.User != nil {
		return errors.New("ugyldig adresse")
	}
	return nil
}

func fetch(ctx context.Context, raw, accept string) (*http.Response, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, err
	}
	if err := checkURL(u); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", accept)
	req.Header.Set("Accept-Language", "nb-NO,nb;q=0.9,nn;q=0.8,en;q=0.6")
	return safeClient.Do(req)
}

// Preview er det appen klarte å lese ut av ei produktside.
type Preview struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
	Currency    string  `json:"currency"`
	Shop        string  `json:"shop"`
	Image       string  `json:"image"`
	URL         string  `json:"url"`
	Partial     bool    `json:"partial"`
}

func (s *server) preview(e *core.RequestEvent) error {
	var body struct {
		URL string `json:"url"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Ugyldig førespurnad.", err)
	}
	ctx, cancel := context.WithTimeout(e.Request.Context(), 80*time.Second)
	defer cancel()

	u, err := url.Parse(strings.TrimSpace(body.URL))
	if err != nil || checkURL(u) != nil {
		return e.BadRequestError("Det ser ikkje ut som ei gyldig lenke.", err)
	}

	p, text := readPage(ctx, u.String())
	p.URL = u.String()
	if p.Shop == "" {
		p.Shop = shopFromHost(u.Hostname())
	}
	if p.Title == "" || p.Price == 0 {
		cfg := s.settings(e.App)
		if s.ai.hasKey() && cfg.AIEnabled && s.ai.allow(e.Auth.Id, cfg.AIDailyLimit) {
			if strings.TrimSpace(text) != "" {
				s.ai.enrich(ctx, cfg.AIModel, &p, text)
			} else {
				// Butikken stengde for oppslaget, så vi spør nettsøket om produktet i staden.
				s.ai.lookup(ctx, cfg.AIModel, &p)
			}
		}
	}
	if p.Title == "" {
		p.Title = titleFromURL(u.String())
	}
	p.Partial = p.Title == "" || p.Price == 0 || p.Image == ""
	return e.JSON(http.StatusOK, p)
}

// readPage les ei produktside. Om butikken nektar eller sida ikkje er HTML, kjem det tilbake tomt.
func readPage(ctx context.Context, target string) (Preview, string) {
	pageCtx, cancel := context.WithTimeout(ctx, 14*time.Second)
	defer cancel()
	res, err := fetch(pageCtx, target, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
	if err != nil {
		return Preview{}, ""
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 || !strings.Contains(strings.ToLower(res.Header.Get("Content-Type")), "html") {
		return Preview{}, ""
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxPageBytes))
	if err != nil {
		return Preview{}, ""
	}
	return parsePage(string(data), res.Request.URL)
}

// titleFromURL lagar eit namn av lenka, som siste utveg når ingenting anna er tilgjengeleg.
func titleFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	segments := strings.Split(strings.Trim(u.Path, "/"), "/")
	for i := len(segments) - 1; i >= 0; i-- {
		segment := strings.TrimSuffix(strings.TrimSuffix(segments[i], ".html"), ".htm")
		words := strings.FieldsFunc(segment, func(r rune) bool { return r == '-' || r == '_' || r == '+' })
		real := 0
		for _, w := range words {
			if len([]rune(w)) >= 3 && strings.IndexFunc(w, unicode.IsLetter) >= 0 {
				real++
			}
		}
		if real >= 2 {
			title := []rune(strings.Join(words, " "))
			title[0] = unicode.ToUpper(title[0])
			return truncate(string(title), 200)
		}
	}
	return ""
}

func shopFromHost(host string) string {
	parts := strings.Split(strings.ToLower(host), ".")
	if len(parts) < 2 {
		return ""
	}
	host = parts[len(parts)-2]
	if host == "" {
		return ""
	}
	return strings.ToUpper(host[:1]) + host[1:]
}

func parsePage(doc string, base *url.URL) (Preview, string) {
	var p Preview
	meta := map[string]string{}
	var jsonLD []string
	var titleTag string
	var text strings.Builder

	z := html.NewTokenizer(strings.NewReader(doc))
	var skip, inLD, inTitle bool
loop:
	for {
		switch z.Next() {
		case html.ErrorToken:
			break loop
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			attrs := map[string]string{}
			for hasAttr {
				var k, v []byte
				k, v, hasAttr = z.TagAttr()
				attrs[string(k)] = string(v)
			}
			switch string(name) {
			case "meta":
				key := strings.ToLower(attrs["property"])
				if key == "" {
					key = strings.ToLower(attrs["name"])
				}
				if key == "" {
					key = strings.ToLower(attrs["itemprop"])
				}
				if key != "" && attrs["content"] != "" {
					if _, seen := meta[key]; !seen {
						meta[key] = attrs["content"]
					}
				}
			case "title":
				inTitle = true
			case "script":
				inLD = strings.Contains(strings.ToLower(attrs["type"]), "ld+json")
				skip = !inLD
			case "style", "noscript", "svg", "nav", "footer":
				skip = true
			}
		case html.EndTagToken:
			name, _ := z.TagName()
			switch string(name) {
			case "title":
				inTitle = false
			case "script", "style", "noscript", "svg", "nav", "footer":
				skip, inLD = false, false
			}
		case html.TextToken:
			t := string(z.Text())
			switch {
			case inLD:
				jsonLD = append(jsonLD, t)
			case inTitle:
				if titleTag == "" {
					titleTag = strings.TrimSpace(t)
				}
			case !skip && text.Len() < 16000:
				if clean := strings.TrimSpace(t); clean != "" {
					text.WriteString(clean)
					text.WriteByte('\n')
				}
			}
		}
	}

	for _, raw := range jsonLD {
		var v any
		if json.Unmarshal([]byte(strings.TrimSpace(raw)), &v) == nil {
			applyJSONLD(v, &p)
		}
	}

	first := func(keys ...string) string {
		for _, k := range keys {
			if v := strings.TrimSpace(meta[k]); v != "" {
				return v
			}
		}
		return ""
	}
	if p.Title == "" {
		p.Title = first("og:title", "twitter:title", "name")
	}
	if p.Title == "" {
		p.Title = titleTag
	}
	if p.Description == "" {
		p.Description = first("og:description", "twitter:description", "description")
	}
	if p.Image == "" {
		p.Image = first("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src", "image")
	}
	if p.Price == 0 {
		p.Price = parsePrice(first("product:price:amount", "og:price:amount", "price"))
	}
	if p.Currency == "" {
		p.Currency = strings.ToUpper(first("product:price:currency", "og:price:currency", "pricecurrency"))
	}
	p.Shop = first("og:site_name")
	if p.Shop == "" {
		p.Shop = shopFromHost(base.Hostname())
	}
	if p.Image != "" {
		if ref, err := base.Parse(p.Image); err == nil && checkURL(ref) == nil {
			p.Image = ref.String()
		} else {
			p.Image = ""
		}
	}
	p.Title = truncate(html.UnescapeString(p.Title), 200)
	p.Description = truncate(html.UnescapeString(p.Description), 600)
	return p, text.String()
}

func applyJSONLD(v any, p *Preview) {
	switch t := v.(type) {
	case []any:
		for _, item := range t {
			applyJSONLD(item, p)
		}
	case map[string]any:
		if graph, ok := t["@graph"]; ok {
			applyJSONLD(graph, p)
		}
		if !hasType(t["@type"], "Product") {
			return
		}
		if s, ok := t["name"].(string); ok && p.Title == "" {
			p.Title = strings.TrimSpace(s)
		}
		if s, ok := t["description"].(string); ok && p.Description == "" {
			p.Description = strings.TrimSpace(s)
		}
		if p.Image == "" {
			p.Image = imageFrom(t["image"])
		}
		if p.Price == 0 {
			p.Price, p.Currency = offerPrice(t["offers"])
		}
	}
}

func hasType(v any, want string) bool {
	switch t := v.(type) {
	case string:
		return strings.EqualFold(t, want)
	case []any:
		for _, item := range t {
			if hasType(item, want) {
				return true
			}
		}
	}
	return false
}

func imageFrom(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []any:
		if len(t) > 0 {
			return imageFrom(t[0])
		}
	case map[string]any:
		return imageFrom(t["url"])
	}
	return ""
}

func offerPrice(v any) (float64, string) {
	switch t := v.(type) {
	case []any:
		for _, item := range t {
			if p, c := offerPrice(item); p > 0 {
				return p, c
			}
		}
	case map[string]any:
		currency, _ := t["priceCurrency"].(string)
		for _, key := range []string{"price", "lowPrice"} {
			if p := anyPrice(t[key]); p > 0 {
				return p, strings.ToUpper(currency)
			}
		}
		if spec, ok := t["priceSpecification"]; ok {
			return offerPrice(spec)
		}
	}
	return 0, ""
}

func anyPrice(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case string:
		return parsePrice(t)
	}
	return 0
}

var priceChars = regexp.MustCompile(`[^0-9.,]`)

// parsePrice forstår både «1 299,-», «1.299,00» og «1299.00».
func parsePrice(s string) float64 {
	s = priceChars.ReplaceAllString(s, "")
	s = strings.Trim(s, ".,")
	if s == "" {
		return 0
	}
	lastComma, lastDot := strings.LastIndex(s, ","), strings.LastIndex(s, ".")
	sep := lastComma
	if lastDot > sep {
		sep = lastDot
	}
	if sep >= 0 && len(s)-sep-1 != 3 {
		whole := strings.NewReplacer(".", "", ",", "").Replace(s[:sep])
		s = whole + "." + s[sep+1:]
	} else {
		s = strings.NewReplacer(".", "", ",", "").Replace(s)
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return v
}

func truncate(s string, max int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return strings.TrimSpace(string(r[:max-1])) + "…"
}

// image hentar eit produktbilete via serveren, så det kan lagrast saman med gåva.
func (s *server) image(e *core.RequestEvent) error {
	raw := e.Request.URL.Query().Get("url")
	ctx, cancel := context.WithTimeout(e.Request.Context(), 15*time.Second)
	defer cancel()
	res, err := fetch(ctx, raw, "image/webp,image/jpeg,image/png,image/gif;q=0.9")
	if err != nil {
		return e.BadRequestError("Kunne ikkje hente biletet.", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return e.BadRequestError(fmt.Sprintf("Biletet svarte med %d.", res.StatusCode), nil)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxImageBytes+1))
	if err != nil || len(data) > maxImageBytes {
		return e.BadRequestError("Biletet er for stort.", err)
	}
	mime := http.DetectContentType(data)
	if !isAllowedImage(mime) {
		return e.BadRequestError("Biletformatet er ikkje støtta.", nil)
	}
	e.Response.Header().Set("Content-Type", mime)
	e.Response.Header().Set("Cache-Control", "private, max-age=300")
	e.Response.WriteHeader(http.StatusOK)
	_, err = e.Response.Write(data)
	return err
}

func isAllowedImage(mime string) bool {
	for _, t := range imageTypes {
		if mime == t {
			return true
		}
	}
	return false
}
