package app

import (
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"sort"
	"strings"
)

// Oppgjersmotoren er rein logikk utan database, og alle beløp er heile øre.

// Payer er ein som har lagt ut eit beløp.
type Payer struct {
	Person string `json:"person"`
	Ore    int64  `json:"ore"`
}

// Share seier korleis ein person skal vere med på å dekkje eit utlegg.
// Fixed er eit fast beløp i øre. Resten blir delt etter Weight, og vekt 0 betyr at personen slepp å betale.
type Share struct {
	Person string  `json:"person"`
	Weight float64 `json:"weight"`
	Fixed  *int64  `json:"fixed,omitempty"`
}

// Expense er eit utlegg, eller ein refusjon når Refund er sann.
type Expense struct {
	ID        string
	Refund    bool
	Payers    []Payer
	Allocated map[string]int64
	Wallets   map[string]string // Kven som bar kostnaden då utlegget blei gjort.
}

// Settlement er ein betaling eller ettergjeving frå skuldnar til kreditor.
// From og To er den som bar kostnaden då oppgjeret blei gjort.
type Settlement struct {
	From string
	To   string
	Ore  int64
}

// SplitKey gjev same avrunding for same beløp og same personar, så ei full retur nullar ut på øret.
func SplitKey(total int64, shares []Share) string {
	people := make([]string, len(shares))
	for i, s := range shares {
		people[i] = s.Person
	}
	sort.Strings(people)
	return fmt.Sprintf("%d:%s", total, strings.Join(people, ","))
}

// Transfer er ei overføring som gjer opp ei skuld.
type Transfer struct {
	From       string `json:"from"`
	To         string `json:"to"`
	Ore        int64  `json:"ore"`
	Simplified bool   `json:"simplified"`
}

const weightScale = 1000

// Split fordeler total på delane. Summen blir alltid nøyaktig total, og restøre går til dei som har størst
// avrundingsrest. Ved likt blir det avgjort av key, så den same personen ikkje alltid må ta den ekstra øren.
func Split(total int64, shares []Share, key string) (map[string]int64, error) {
	if total <= 0 {
		return nil, errors.New("Beløpet må vere større enn 0.")
	}
	if len(shares) == 0 {
		return nil, errors.New("Vel minst éin som skal vere med på å betale.")
	}
	result := make(map[string]int64, len(shares))
	seen := map[string]bool{}
	rest := total
	type weighted struct {
		person string
		weight int64
	}
	var flexible []weighted
	var weightSum int64
	for _, s := range shares {
		if s.Person == "" || seen[s.Person] {
			return nil, errors.New("Same person kan ikkje vere med to gonger.")
		}
		seen[s.Person] = true
		if s.Fixed != nil {
			if *s.Fixed < 0 {
				return nil, errors.New("Faste beløp kan ikkje vere negative.")
			}
			result[s.Person] = *s.Fixed
			rest -= *s.Fixed
			continue
		}
		if s.Weight < 0 || math.IsNaN(s.Weight) || math.IsInf(s.Weight, 0) {
			return nil, errors.New("Delane kan ikkje vere negative.")
		}
		w := int64(math.Round(s.Weight * weightScale))
		result[s.Person] = 0
		if w > 0 {
			flexible = append(flexible, weighted{s.Person, w})
			weightSum += w
		}
	}
	if rest < 0 {
		return nil, errors.New("Dei faste beløpa er større enn heile utlegget.")
	}
	if rest == 0 {
		return result, nil
	}
	if weightSum == 0 {
		return nil, errors.New("Delane må dekkje heile beløpet. Noko står att.")
	}

	type part struct {
		person    string
		remainder int64
		tie       uint32
	}
	parts := make([]part, 0, len(flexible))
	var assigned int64
	for _, f := range flexible {
		base := rest * f.weight / weightSum
		result[f.person] = base
		assigned += base
		parts = append(parts, part{f.person, rest*f.weight - base*weightSum, tieBreak(key, f.person)})
	}
	sort.Slice(parts, func(i, j int) bool {
		if parts[i].remainder != parts[j].remainder {
			return parts[i].remainder > parts[j].remainder
		}
		if parts[i].tie != parts[j].tie {
			return parts[i].tie < parts[j].tie
		}
		return parts[i].person < parts[j].person
	})
	for i := int64(0); i < rest-assigned; i++ {
		result[parts[i].person]++
	}
	return result, nil
}

func tieBreak(key, person string) uint32 {
	h := fnv.New32a()
	h.Write([]byte(key + "/" + person))
	return h.Sum32()
}

// WalletResolver finn kven som i praksis ber kostnaden for ein person: seg sjølv, ein forelder eller eit hushald.
// Om nokon peikar på kvarandre i ring, deler alle i ringen éi lommebok.
func WalletResolver(coveredBy map[string]string) func(string) string {
	return func(person string) string {
		current := person
		path := []string{person}
		seen := map[string]int{person: 0}
		for {
			next := coveredBy[current]
			if next == "" {
				return current
			}
			if at, loop := seen[next]; loop {
				smallest := path[at]
				for _, p := range path[at:] {
					if p < smallest {
						smallest = p
					}
				}
				return smallest
			}
			seen[next] = len(path)
			path = append(path, next)
			current = next
		}
	}
}

// Ledger er nettoskuld mellom par. For nøkkelen {a, b} der a < b betyr positiv verdi at a skuldar b.
type Ledger map[[2]string]int64

func (l Ledger) add(debtor, creditor string, ore int64) {
	if debtor == creditor || ore == 0 {
		return
	}
	if debtor < creditor {
		l[[2]string{debtor, creditor}] += ore
	} else {
		l[[2]string{creditor, debtor}] -= ore
	}
}

// Debt gjev kor mykje debtor netto skuldar creditor. Negativt tal betyr motsett veg.
func (l Ledger) Debt(debtor, creditor string) int64 {
	if debtor < creditor {
		return l[[2]string{debtor, creditor}]
	}
	return -l[[2]string{creditor, debtor}]
}

type position struct {
	party string
	ore   int64
}

// BuildLedger reknar ut nettoskuld etter alle utlegg, refusjonar og stadfesta oppgjer.
func BuildLedger(expenses []Expense, settlements []Settlement, wallet func(string) string) Ledger {
	ledger := Ledger{}
	for _, e := range expenses {
		// Lommeboka frå utleggsdagen gjeld, så ei seinare endring ikkje skriv om gamle år.
		owner := func(person string) string {
			if w := e.Wallets[person]; w != "" {
				return wallet(w)
			}
			return wallet(person)
		}
		net := map[string]int64{}
		for _, p := range e.Payers {
			net[owner(p.Person)] += p.Ore
		}
		for person, ore := range e.Allocated {
			net[owner(person)] -= ore
		}
		var creditors, debtors []position
		for party, ore := range net {
			if e.Refund {
				ore = -ore // Den som fekk pengane tilbake, skal gje dei vidare.
			}
			if ore > 0 {
				creditors = append(creditors, position{party, ore})
			} else if ore < 0 {
				debtors = append(debtors, position{party, -ore})
			}
		}
		matchPositions(debtors, creditors, func(from, to string, ore int64) { ledger.add(from, to, ore) })
	}
	for _, s := range settlements {
		ledger.add(wallet(s.From), wallet(s.To), -s.Ore)
	}
	return ledger
}

// matchPositions parar skuldnarar og kreditorar i fast rekkjefølgje, slik at resultatet alltid er det same.
func matchPositions(debtors, creditors []position, pay func(from, to string, ore int64)) {
	sortPositions(debtors)
	sortPositions(creditors)
	for i, j := 0, 0; i < len(debtors) && j < len(creditors); {
		amount := min(debtors[i].ore, creditors[j].ore)
		pay(debtors[i].party, creditors[j].party, amount)
		debtors[i].ore -= amount
		creditors[j].ore -= amount
		if debtors[i].ore == 0 {
			i++
		}
		if creditors[j].ore == 0 {
			j++
		}
	}
}

func sortPositions(p []position) {
	sort.Slice(p, func(i, j int) bool {
		if p[i].ore != p[j].ore {
			return p[i].ore > p[j].ore
		}
		return p[i].party < p[j].party
	})
}

// Plan lagar overføringane. Skuld mellom folk som har sagt ja til forenkling blir samla i så få overføringar som
// råd. Andre betaler alltid direkte til den dei skuldar, så ingen blir dregne inn i andre sine mellomverande.
// Beløp under minOre blir ikkje foreslått.
func Plan(ledger Ledger, canSimplify func(string) bool, minOre int64) []Transfer {
	ledger = cancelCycles(ledger)
	var out []Transfer
	balance := map[string]int64{}
	for pair, ore := range ledger {
		if ore == 0 {
			continue
		}
		debtor, creditor := pair[0], pair[1]
		if ore < 0 {
			debtor, creditor, ore = creditor, debtor, -ore
		}
		if canSimplify(debtor) && canSimplify(creditor) {
			balance[debtor] -= ore
			balance[creditor] += ore
		} else if ore >= minOre {
			out = append(out, Transfer{From: debtor, To: creditor, Ore: ore})
		}
	}

	var debtors, creditors []position
	for party, ore := range balance {
		if ore < 0 {
			debtors = append(debtors, position{party, -ore})
		} else if ore > 0 {
			creditors = append(creditors, position{party, ore})
		}
	}
	sortPositions(debtors)
	sortPositions(creditors)

	// Like beløp fyrst, for dei gjer opp to personar med éi overføring.
	for i := range debtors {
		for j := range creditors {
			if debtors[i].ore > 0 && debtors[i].ore == creditors[j].ore {
				out = appendSimplified(out, ledger, debtors[i].party, creditors[j].party, debtors[i].ore, minOre)
				debtors[i].ore, creditors[j].ore = 0, 0
				break
			}
		}
	}
	remainingD, remainingC := nonZero(debtors), nonZero(creditors)
	matchPositions(remainingD, remainingC, func(from, to string, ore int64) {
		out = appendSimplified(out, ledger, from, to, ore, minOre)
	})

	sort.Slice(out, func(i, j int) bool {
		if out[i].Ore != out[j].Ore {
			return out[i].Ore > out[j].Ore
		}
		if out[i].From != out[j].From {
			return out[i].From < out[j].From
		}
		return out[i].To < out[j].To
	})
	return out
}

// cancelCycles fjernar skuld som går i ring. Det endrar ikkje kva nokon står att med,
// og ingen får ny skuld til andre enn dei alt skulda.
func cancelCycles(ledger Ledger) Ledger {
	out := Ledger{}
	for pair, ore := range ledger {
		out[pair] = ore
	}
	for {
		cycle := findCycle(out)
		if cycle == nil {
			return out
		}
		smallest := int64(math.MaxInt64)
		for i, from := range cycle {
			smallest = min(smallest, out.Debt(from, cycle[(i+1)%len(cycle)]))
		}
		for i, from := range cycle {
			out.add(from, cycle[(i+1)%len(cycle)], -smallest)
		}
	}
}

func findCycle(ledger Ledger) []string {
	edges := map[string][]string{}
	for pair, ore := range ledger {
		switch {
		case ore > 0:
			edges[pair[0]] = append(edges[pair[0]], pair[1])
		case ore < 0:
			edges[pair[1]] = append(edges[pair[1]], pair[0])
		}
	}
	nodes := make([]string, 0, len(edges))
	for node := range edges {
		sort.Strings(edges[node])
		nodes = append(nodes, node)
	}
	sort.Strings(nodes)

	state := map[string]int{} // 1 = på vegen no, 2 = ferdig.
	var path []string
	var visit func(string) []string
	visit = func(node string) []string {
		state[node] = 1
		path = append(path, node)
		for _, next := range edges[node] {
			if state[next] == 1 {
				for i, p := range path {
					if p == next {
						return append([]string{}, path[i:]...)
					}
				}
			}
			if state[next] == 0 {
				if found := visit(next); found != nil {
					return found
				}
			}
		}
		state[node] = 2
		path = path[:len(path)-1]
		return nil
	}
	for _, node := range nodes {
		if state[node] == 0 {
			if found := visit(node); found != nil {
				return found
			}
		}
	}
	return nil
}

func appendSimplified(out []Transfer, ledger Ledger, from, to string, ore, minOre int64) []Transfer {
	if ore < minOre {
		return out
	}
	return append(out, Transfer{From: from, To: to, Ore: ore, Simplified: ledger.Debt(from, to) != ore})
}

func nonZero(p []position) []position {
	out := p[:0:0]
	for _, x := range p {
		if x.ore > 0 {
			out = append(out, x)
		}
	}
	return out
}
