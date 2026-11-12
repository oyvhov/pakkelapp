package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAIChallengeDoesNotFillPreview(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, `{"output":[{"content":[{"type":"output_text","text":%q}]}]}`,
			`{"title":"Client Challenge","price":99,"currency":"NOK","image":"https://example.test/logo.png"}`)
	}))
	t.Cleanup(upstream.Close)
	n := newNisse(Config{AIBaseURL: upstream.URL})
	want := Preview{URL: windflameURL}

	p := want
	n.lookup(t.Context(), "test", &p)
	if p != want {
		t.Errorf("nettsøket brukte kontrollsida: %+v", p)
	}
	p = want
	n.enrich(t.Context(), "test", &p, "Please enable JavaScript to continue.")
	if p != want {
		t.Errorf("tekstoppslaget brukte kontrollsida: %+v", p)
	}
}

func TestCleanReplyWithoutWebDropsGuessedLinks(t *testing.T) {
	res := &aiResult{
		Text:    `{"reply":"Her er idear","needs_web":false,"suggestions":[{"title":"Kopp","why":"Fin","price_estimate":250,"shop":"Gjetta butikk","url":"https://example.com/kopp","search":"keramikk kopp"},{"title":" ","why":"","price_estimate":0,"shop":"","url":"","search":""}]}`,
		Sources: map[string]bool{},
		URLs:    map[string]bool{},
	}
	out, ok := cleanReply(res)
	if !ok || out.NeedsWeb || out.Reply != "Her er idear" {
		t.Fatalf("uventa svar: %+v %v", out, ok)
	}
	if len(out.Suggestions) != 1 {
		t.Fatalf("tomt forslag skal fjernast, fekk %d", len(out.Suggestions))
	}
	if sg := out.Suggestions[0]; sg.URL != "" || sg.Shop != "" || sg.Query != "keramikk kopp" {
		t.Fatalf("gjetta lenke eller butikk skal ikkje visast: %+v", sg)
	}
}

func TestCleanReplyKeepsNeedsWeb(t *testing.T) {
	out, ok := cleanReply(&aiResult{Text: `{"reply":"","needs_web":true,"suggestions":[]}`, URLs: map[string]bool{}})
	if !ok || !out.NeedsWeb {
		t.Fatalf("needs_web skal lesast: %+v", out)
	}
}

func TestCleanReplyTruncated(t *testing.T) {
	out, ok := cleanReply(&aiResult{Text: `{"reply":"Her er`, URLs: map[string]bool{}})
	if ok || out.Reply == "" || out.Reply[0] == '{' {
		t.Fatalf("avkutta JSON skal gje ei venleg melding: %+v", out)
	}
}

func TestMatchShops(t *testing.T) {
	res := &aiResult{
		Text: `{"items":[
			{"index":0,"url":"https://www.butikk.no/kopp-123?ref=x","price":299,"shop":"Butikk"},
			{"index":0,"url":"https://www.butikk.no/kopp-999","price":1,"shop":"Dobbel"},
			{"index":1,"url":"https://oppdikta.no/vare","price":100,"shop":"Oppdikta"},
			{"index":2,"url":"https://annan.no/ting","price":-5,"shop":""},
			{"index":7,"url":"https://www.butikk.no/kopp-123","price":5,"shop":"Utanfor"}
		]}`,
		URLs: map[string]bool{"butikk.no/kopp-123": true, "annan.no/ting": true},
	}
	got := matchShops(res, 3)
	if len(got) != 2 {
		t.Fatalf("venta 2 treff, fekk %+v", got)
	}
	if got[0].Index != 0 || got[0].Shop != "Butikk" || got[0].Price != 299 {
		t.Fatalf("første treff feil: %+v", got[0])
	}
	if got[1].Index != 2 || got[1].Shop != "annan.no" || got[1].Price != 0 {
		t.Fatalf("butikknamn skal kome frå adressa og negativ pris bli 0: %+v", got[1])
	}
}
