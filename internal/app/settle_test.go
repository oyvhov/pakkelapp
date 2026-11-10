package app

import (
	"testing"
	"time"
)

func ptr(v int64) *int64 { return &v }

func equal(people ...string) []Share {
	out := make([]Share, len(people))
	for i, p := range people {
		out[i] = Share{Person: p, Weight: 1}
	}
	return out
}

func sum(m map[string]int64) (t int64) {
	for _, v := range m {
		t += v
	}
	return
}

func self(p string) string { return p }

func always(string) bool { return true }
func never(string) bool  { return false }

func mustSplit(t *testing.T, total int64, shares []Share) map[string]int64 {
	t.Helper()
	m, err := Split(total, shares, "e1")
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestSplitIsAlwaysExact(t *testing.T) {
	for _, total := range []int64{1, 2, 99, 100, 101, 1000, 33333, 99999, 123456789} {
		for n := 1; n <= 9; n++ {
			shares := make([]Share, n)
			for i := range shares {
				shares[i] = Share{Person: string(rune('a' + i)), Weight: float64(i%3 + 1)}
			}
			if got := sum(mustSplit(t, total, shares)); got != total {
				t.Fatalf("total %d på %d personar blei %d", total, n, got)
			}
		}
	}
}

func TestSplitEqualRoundingDiffersByOneOre(t *testing.T) {
	m := mustSplit(t, 10000, equal("a", "b", "c"))
	lo, hi := int64(1<<62), int64(0)
	for _, v := range m {
		lo, hi = min(lo, v), max(hi, v)
	}
	if hi-lo != 1 {
		t.Fatalf("skilnaden skal vere 1 øre: %v", m)
	}
}

func TestSplitExtraOreRotatesBetweenExpenses(t *testing.T) {
	got := map[string]int{}
	for _, key := range []string{"a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9", "j0", "k1", "l2"} {
		m, _ := Split(100, equal("a", "b", "c"), key)
		for p, v := range m {
			if v == 34 {
				got[p]++
			}
		}
	}
	if len(got) < 2 {
		t.Fatalf("same person får alltid den ekstra øren: %v", got)
	}
}

func TestSplitWeightsFixedAndExempt(t *testing.T) {
	m := mustSplit(t, 30000, []Share{{Person: "a", Weight: 2}, {Person: "b", Weight: 1}})
	if m["a"] != 20000 || m["b"] != 10000 {
		t.Fatalf("delar: %v", m)
	}
	m = mustSplit(t, 30000, []Share{{Person: "a", Fixed: ptr(5000)}, {Person: "b", Weight: 1}, {Person: "c", Weight: 1}})
	if m["a"] != 5000 || m["b"] != 12500 || m["c"] != 12500 {
		t.Fatalf("fast + resten likt: %v", m)
	}
	m = mustSplit(t, 30000, []Share{{Person: "a", Weight: 1}, {Person: "barn", Weight: 0}})
	if m["a"] != 30000 || m["barn"] != 0 {
		t.Fatalf("fritak: %v", m)
	}
	m = mustSplit(t, 30000, []Share{{Person: "a", Fixed: ptr(30000)}, {Person: "b", Weight: 1}})
	if m["b"] != 0 {
		t.Fatalf("fast dekkjer alt: %v", m)
	}
	m = mustSplit(t, 10000, []Share{{Person: "a", Weight: 33.3}, {Person: "b", Weight: 66.7}})
	if m["a"] != 3330 || m["b"] != 6670 {
		t.Fatalf("prosent: %v", m)
	}
}

func TestSplitRejectsInvalid(t *testing.T) {
	bad := []struct {
		total  int64
		shares []Share
	}{
		{0, equal("a")},
		{-5, equal("a")},
		{100, nil},
		{100, []Share{{Person: "a", Fixed: ptr(200)}}},
		{100, []Share{{Person: "a", Fixed: ptr(50)}}},
		{100, []Share{{Person: "a", Weight: 0}}},
		{100, []Share{{Person: "a", Weight: -1}}},
		{100, []Share{{Person: "a", Weight: 1}, {Person: "a", Weight: 1}}},
		{100, []Share{{Person: "a", Fixed: ptr(-1)}, {Person: "b", Weight: 1}}},
	}
	for i, c := range bad {
		if _, err := Split(c.total, c.shares, "k"); err == nil {
			t.Errorf("tilfelle %d skulle vore avvist", i)
		}
	}
}

func expense(id string, payers []Payer, alloc map[string]int64) Expense {
	return Expense{ID: id, Payers: payers, Allocated: alloc}
}

func TestPayerInSplitOnlyOwesOthersShare(t *testing.T) {
	l := BuildLedger([]Expense{expense("1", []Payer{{"a", 30000}}, map[string]int64{"a": 10000, "b": 10000, "c": 10000})}, nil, self)
	if l.Debt("b", "a") != 10000 || l.Debt("c", "a") != 10000 || l.Debt("b", "c") != 0 {
		t.Fatalf("%v", l)
	}
}

func TestPayerOutsideSplit(t *testing.T) {
	l := BuildLedger([]Expense{expense("1", []Payer{{"mor", 10000}}, map[string]int64{"b": 5000, "c": 5000})}, nil, self)
	if l.Debt("b", "mor") != 5000 || l.Debt("c", "mor") != 5000 {
		t.Fatalf("%v", l)
	}
}

func TestMultiplePayers(t *testing.T) {
	// A og B la ut 150 kvar for ei gåve dei tre deler likt.
	l := BuildLedger([]Expense{expense("1", []Payer{{"a", 15000}, {"b", 15000}}, map[string]int64{"a": 10000, "b": 10000, "c": 10000})}, nil, self)
	if l.Debt("c", "a")+l.Debt("c", "b") != 10000 || l.Debt("a", "b") != 0 {
		t.Fatalf("%v", l)
	}
}

func TestMutualDebtNetsOut(t *testing.T) {
	l := BuildLedger([]Expense{
		expense("1", []Payer{{"a", 10000}}, map[string]int64{"b": 10000}),
		expense("2", []Payer{{"b", 4000}}, map[string]int64{"a": 4000}),
	}, nil, self)
	if l.Debt("b", "a") != 6000 || l.Debt("a", "b") != -6000 {
		t.Fatalf("%v", l)
	}
}

func TestRefundReversesExpense(t *testing.T) {
	buy := expense("1", []Payer{{"a", 20000}}, map[string]int64{"a": 10000, "b": 10000})
	full := Expense{ID: "2", Refund: true, Payers: []Payer{{"a", 20000}}, Allocated: map[string]int64{"a": 10000, "b": 10000}}
	if d := BuildLedger([]Expense{buy, full}, nil, self).Debt("b", "a"); d != 0 {
		t.Fatalf("full retur skal nulle ut: %d", d)
	}
	partial := Expense{ID: "3", Refund: true, Payers: []Payer{{"a", 5000}}, Allocated: map[string]int64{"a": 2500, "b": 2500}}
	if d := BuildLedger([]Expense{buy, partial}, nil, self).Debt("b", "a"); d != 7500 {
		t.Fatalf("delvis retur: %d", d)
	}
}

func TestChildAndHouseholdRollUp(t *testing.T) {
	wallet := WalletResolver(map[string]string{"emil": "anne", "ola": "anne"})
	// Emil og ektemannen Ola er begge dekte av Anne, så det blir éi skuld.
	l := BuildLedger([]Expense{expense("1", []Payer{{"kari", 30000}}, map[string]int64{"emil": 10000, "ola": 10000, "kari": 10000})}, nil, wallet)
	if l.Debt("anne", "kari") != 20000 {
		t.Fatalf("%v", l)
	}
	// Innanfor same hushald er det inga skuld.
	l = BuildLedger([]Expense{expense("2", []Payer{{"ola", 10000}}, map[string]int64{"anne": 10000})}, nil, wallet)
	if len(nonZeroLedger(l)) != 0 {
		t.Fatalf("hushald skal ikkje skulde seg sjølv: %v", l)
	}
}

func nonZeroLedger(l Ledger) Ledger {
	out := Ledger{}
	for k, v := range l {
		if v != 0 {
			out[k] = v
		}
	}
	return out
}

func TestWalletCycleAndChain(t *testing.T) {
	w := WalletResolver(map[string]string{"a": "b", "b": "c"})
	if w("a") != "c" {
		t.Fatal("kjede")
	}
	w = WalletResolver(map[string]string{"a": "b", "b": "a"})
	if w("a") != "a" || w("b") != "a" {
		t.Fatalf("to som peikar på kvarandre skal dele lommebok: %s %s", w("a"), w("b"))
	}
	w = WalletResolver(map[string]string{"a": "a"})
	if w("a") != "a" {
		t.Fatal("seg sjølv")
	}
}

func TestSettlements(t *testing.T) {
	buy := []Expense{expense("1", []Payer{{"a", 10000}}, map[string]int64{"b": 10000})}
	if d := BuildLedger(buy, []Settlement{{"b", "a", 4000}}, self).Debt("b", "a"); d != 6000 {
		t.Fatalf("delbetaling: %d", d)
	}
	if d := BuildLedger(buy, []Settlement{{"b", "a", 10000}}, self).Debt("b", "a"); d != 0 {
		t.Fatalf("full betaling: %d", d)
	}
	if d := BuildLedger(buy, []Settlement{{"b", "a", 12000}}, self).Debt("a", "b"); d != 2000 {
		t.Fatalf("overbetaling skal snu skulda: %d", d)
	}
}

func TestPlanSimplifiesChain(t *testing.T) {
	l := BuildLedger([]Expense{
		expense("1", []Payer{{"b", 10000}}, map[string]int64{"a": 10000}),
		expense("2", []Payer{{"c", 10000}}, map[string]int64{"b": 10000}),
	}, nil, self)
	p := Plan(l, always, 100)
	if len(p) != 1 || p[0].From != "a" || p[0].To != "c" || p[0].Ore != 10000 || !p[0].Simplified {
		t.Fatalf("%+v", p)
	}
}

func TestPlanCycleCancels(t *testing.T) {
	l := BuildLedger([]Expense{
		expense("1", []Payer{{"b", 5000}}, map[string]int64{"a": 5000}),
		expense("2", []Payer{{"c", 5000}}, map[string]int64{"b": 5000}),
		expense("3", []Payer{{"a", 5000}}, map[string]int64{"c": 5000}),
	}, nil, self)
	if p := Plan(l, always, 100); len(p) != 0 {
		t.Fatalf("%+v", p)
	}
}

func TestPlanOptOutStaysDirect(t *testing.T) {
	l := BuildLedger([]Expense{
		expense("1", []Payer{{"b", 10000}}, map[string]int64{"a": 10000}),
		expense("2", []Payer{{"c", 10000}}, map[string]int64{"b": 10000}),
	}, nil, self)
	p := Plan(l, never, 100)
	if len(p) != 2 {
		t.Fatalf("%+v", p)
	}
	for _, x := range p {
		if x.Simplified {
			t.Fatalf("skal ikkje vere forenkla: %+v", x)
		}
	}
	// Ein som har sagt nei, blir aldri ruta gjennom.
	p = Plan(l, func(s string) bool { return s != "b" }, 100)
	if len(p) != 2 || l.Debt(p[0].From, p[0].To) != p[0].Ore {
		t.Fatalf("%+v", p)
	}
}

func TestPlanPreservesBalancesAndIsDeterministic(t *testing.T) {
	var ex []Expense
	people := []string{"a", "b", "c", "d", "e", "f"}
	for i := 0; i < 40; i++ {
		payer := people[i%6]
		alloc, _ := Split(int64(1000+i*137), equal(people[(i+1)%6], people[(i+2)%6], people[(i+4)%6]), string(rune(i)))
		ex = append(ex, expense(string(rune(i)), []Payer{{payer, int64(1000 + i*137)}}, alloc))
	}
	l := BuildLedger(ex, nil, self)
	want := map[string]int64{}
	for k, v := range l {
		want[k[0]] -= v
		want[k[1]] += v
	}
	first := Plan(l, always, 1)
	got := map[string]int64{}
	for _, tr := range first {
		got[tr.From] -= tr.Ore
		got[tr.To] += tr.Ore
	}
	for _, p := range people {
		if got[p] != want[p] {
			t.Fatalf("%s: %d != %d", p, got[p], want[p])
		}
	}
	if len(first) > len(people)-1 {
		t.Fatalf("for mange overføringar: %d", len(first))
	}
	for i := 0; i < 20; i++ {
		again := Plan(l, always, 1)
		if len(again) != len(first) {
			t.Fatal("ikkje deterministisk")
		}
		for j := range again {
			if again[j] != first[j] {
				t.Fatal("ikkje deterministisk")
			}
		}
	}
}

func TestCycleIsCancelledEvenWithoutSimplifying(t *testing.T) {
	// A betalte C direkte i ein forenkla runde. Slår ein så av forenkling, skal ikkje skulda kome tilbake.
	l := BuildLedger([]Expense{
		expense("1", []Payer{{"b", 10000}}, map[string]int64{"a": 10000}),
		expense("2", []Payer{{"c", 10000}}, map[string]int64{"b": 10000}),
	}, []Settlement{{"a", "c", 10000}}, self)
	if p := Plan(l, never, 100); len(p) != 0 {
		t.Fatalf("alt er betalt, men fekk %+v", p)
	}
}

func TestFullRefundCancelsToTheOre(t *testing.T) {
	shares := equal("x", "y", "z")
	buy, _ := Split(100, shares, SplitKey(100, shares))
	back, _ := Split(100, shares, SplitKey(100, shares))
	l := BuildLedger([]Expense{
		{ID: "1", Payers: []Payer{{"x", 100}}, Allocated: buy},
		{ID: "2", Refund: true, Payers: []Payer{{"x", 100}}, Allocated: back},
	}, nil, self)
	if len(nonZeroLedger(l)) != 0 {
		t.Fatalf("full retur skal nulle ut: %v", l)
	}
}

func TestWalletSnapshotKeepsHistory(t *testing.T) {
	// Ola gjekk via mor då utlegget blei gjort, men gjer det ikkje lenger.
	old := Expense{ID: "1", Payers: []Payer{{"carl", 50000}}, Allocated: map[string]int64{"ola": 50000}, Wallets: map[string]string{"carl": "carl", "ola": "mor"}}
	l := BuildLedger([]Expense{old}, []Settlement{{"mor", "carl", 50000}}, self)
	if len(nonZeroLedger(l)) != 0 {
		t.Fatalf("gamal skuld skal framleis vere oppgjort: %v", l)
	}
	// Bjørn og Anne hadde skuld seg imellom, og blir seinare eitt hushald.
	merged := WalletResolver(map[string]string{"bjorn": "anne"})
	earlier := Expense{ID: "2", Payers: []Payer{{"anne", 100}}, Allocated: map[string]int64{"bjorn": 100}, Wallets: map[string]string{"anne": "anne", "bjorn": "bjorn"}}
	if l := BuildLedger([]Expense{earlier}, nil, merged); len(nonZeroLedger(l)) != 0 {
		t.Fatalf("hushald skal ikkje skulde seg sjølv: %v", l)
	}
}

func TestRevealOpensOnChristmasEveEvening(t *testing.T) {
	at := func(month time.Month, day, hour, year int) time.Time {
		return time.Date(year, month, day, hour, 0, 0, 0, time.UTC)
	}
	cases := []struct {
		now  time.Time
		want int
	}{
		{at(time.December, 24, 17, 2026), 0},
		{at(time.December, 24, 18, 2026), 2026},
		{at(time.December, 31, 12, 2026), 2026},
		{at(time.January, 10, 12, 2027), 2026},
		{at(time.February, 28, 12, 2027), 2026},
		{at(time.March, 1, 12, 2027), 0},
		{at(time.November, 9, 12, 2026), 0},
	}
	for _, c := range cases {
		if got := revealYear(c.now); got != c.want {
			t.Errorf("%v: fekk %d, venta %d", c.now, got, c.want)
		}
	}
}

func TestPlanIgnoresSmallChange(t *testing.T) {
	l := BuildLedger([]Expense{expense("1", []Payer{{"a", 50}}, map[string]int64{"b": 50})}, nil, self)
	if p := Plan(l, always, 100); len(p) != 0 {
		t.Fatalf("%+v", p)
	}
}

func TestPlanDirectIsNotMarkedSimplified(t *testing.T) {
	l := BuildLedger([]Expense{expense("1", []Payer{{"a", 10000}}, map[string]int64{"b": 10000})}, nil, self)
	p := Plan(l, always, 100)
	if len(p) != 1 || p[0].Simplified {
		t.Fatalf("%+v", p)
	}
}
