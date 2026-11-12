package app

import (
	"net"
	"net/url"
	"testing"
)

const windflameURL = "https://www.clasohlson.com/no/Sunwind-Windflame-gassovn/p/36-8020"

func TestParsePrice(t *testing.T) {
	cases := map[string]float64{
		"1 299,-":  1299,
		"1.299,00": 1299,
		"1299.00":  1299,
		"1,299":    1299,
		"49,90 kr": 49.9,
		"12 499":   12499,
		"":         0,
		"Utseld":   0,
	}
	for in, want := range cases {
		if got := parsePrice(in); got != want {
			t.Errorf("parsePrice(%q) = %v, vil ha %v", in, got, want)
		}
	}
}

func TestTitleFromURL(t *testing.T) {
	cases := map[string]string{
		windflameURL: "Sunwind Windflame gassovn",
		"https://www.moominarabia.com/no-no/products/mummi-kopp-0-3-l-vinternattsglod":  "Mummi kopp 0 3 l vinternattsglod",
		"https://www.proshop.no/LEGO/LEGO-Classic-10698-Kreative-store-klosser/2558436": "LEGO Classic 10698 Kreative store klosser",
		"https://butikk.no/produkt/ull-sokkar.html?farge=raud":                          "Ull sokkar",
		"https://butikk.no/p/1234567":                                                   "",
		"https://butikk.no/no-no/products":                                              "",
		"https://butikk.no/":                                                            "",
	}
	for in, want := range cases {
		if got := titleFromURL(in); got != want {
			t.Errorf("titleFromURL(%q) = %q, vil ha %q", in, got, want)
		}
	}
}

func TestStripCitations(t *testing.T) {
	cases := map[string]string{
		"Lågast hos Proshop. ([proshop.no](https://www.proshop.no/x))": "Lågast hos Proshop.",
		"Sjå [Lego](https://lego.com/a) i dag":                         "Sjå Lego i dag",
		"Ingen lenker her (men parentes)":                              "Ingen lenker her (men parentes)",
	}
	for in, want := range cases {
		if got := stripCitations(in); got != want {
			t.Errorf("stripCitations(%q) = %q, vil ha %q", in, got, want)
		}
	}
}

func TestIsPublicIP(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.0.0.5", "192.168.1.1", "172.17.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "0.0.0.0", "::ffff:127.0.0.1"} {
		if isPublicIP(net.ParseIP(ip)) {
			t.Errorf("%s skulle vore blokkert", ip)
		}
	}
	for _, ip := range []string{"1.1.1.1", "151.101.1.1", "2606:4700::1111"} {
		if !isPublicIP(net.ParseIP(ip)) {
			t.Errorf("%s skulle vore tillate", ip)
		}
	}
}

func TestParsePage(t *testing.T) {
	base, _ := url.Parse("https://www.butikken.no/produkt/1")

	jsonLD := `<html><head><title>Kikkert | Butikken</title><meta property="og:site_name" content="Butikken">
	<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Product"],"name":"Kikkert 8x42","image":["/bilete/k.jpg"],"offers":[{"price":"2 499,00","priceCurrency":"NOK"}]}]}</script></head></html>`
	p, _ := parsePage(jsonLD, base)
	if p.Title != "Kikkert 8x42" || p.Price != 2499 || p.Currency != "NOK" || p.Shop != "Butikken" || p.Image != "https://www.butikken.no/bilete/k.jpg" {
		t.Errorf("JSON-LD vart feil lese: %+v", p)
	}

	og := `<html><head><meta property="og:title" content="Ullgenser &amp; lue"><meta property="og:image" content="https://cdn.no/a.png"><meta property="product:price:amount" content="899.00"></head><body><p>Tekst</p><script>skjult()</script></body></html>`
	p, text := parsePage(og, base)
	if p.Title != "Ullgenser & lue" || p.Price != 899 || p.Image != "https://cdn.no/a.png" || p.Shop != "Butikken" {
		t.Errorf("Open Graph vart feil lese: %+v", p)
	}
	if text != "Tekst\n" {
		t.Errorf("sidetekst: %q", text)
	}

	bad, _ := parsePage(`<meta property="og:image" content="javascript:alert(1)">`, base)
	if bad.Image != "" {
		t.Errorf("farleg bilete-URL vart godteken: %q", bad.Image)
	}
}

func TestParsePageChallenge(t *testing.T) {
	base, _ := url.Parse(windflameURL)
	for _, head := range []string{
		`<title>Client Challenge</title><meta property="og:title" content="Clas Ohlson">`,
		`<meta property="og:title" content="CLIENT  CHALLENGE">`,
		`<title>Just a moment...</title>`,
	} {
		doc := head + `<meta property="og:image" content="/logo.png"><p>Please enable JavaScript to continue.</p>`
		if p, text := parsePage(doc, base); p != (Preview{}) || text != "" {
			t.Errorf("kontrollsida gav produktinfo: %+v, %q", p, text)
		}
	}

	product := `<title>Client Challenge</title><script type="application/ld+json">{"@type":"Product","name":"Sunwind Windflame gassovn"}</script>`
	if p, _ := parsePage(product, base); p.Title != "Sunwind Windflame gassovn" {
		t.Errorf("mista produktnamnet frå JSON-LD: %q", p.Title)
	}
	if p, _ := parsePage(`<title>Client Challenge – kortspel</title>`, base); p.Title != "Client Challenge – kortspel" {
		t.Errorf("mista vanleg sidetittel: %q", p.Title)
	}
}
