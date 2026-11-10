import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, ExternalLink, Loader2, Plus, Search, Send, Sparkles } from 'lucide-react';
import { isRecipient, saveNote, useData } from '../data';
import { useGifts } from '../gifts';
import { errorText, firstName, kr, pb, type Person } from '../lib';
import { Avatar, Empty } from '../ui';

interface Suggestion { title: string; why: string; price_estimate: number; shop: string; url: string; search: string }
interface Message { id: number; role: 'user' | 'assistant'; content: string; suggestions?: Suggestion[]; personId?: string; finding?: boolean }
interface ShopMatch { index: number; url: string; price: number; shop: string }
let nextId = 0;

interface Question {
  id: string;
  ask: (name: string) => string;
  options?: { label: string; value: string; save?: Partial<Person> }[];
  text?: string;
}

const QUESTIONS: Question[] = [
  { id: 'age', ask: (n) => `Kor gammal er ${n}?`, options: [
    { label: 'Småbarn', value: 'småbarn 0–5 år', save: { age_group: 'child' } },
    { label: 'Barn', value: 'barn 6–12 år', save: { age_group: 'child' } },
    { label: 'Tenåring', value: 'tenåring', save: { age_group: 'teen' } },
    { label: 'Vaksen', value: 'vaksen', save: { age_group: 'adult' } },
    { label: 'Eldre', value: 'eldre', save: { age_group: 'elder' } },
  ] },
  { id: 'gender', ask: (n) => `Er ${n} jente/kvinne eller gut/mann?`, options: [
    { label: 'Jente/kvinne', value: 'jente/kvinne', save: { gender: 'female' } },
    { label: 'Gut/mann', value: 'gut/mann', save: { gender: 'male' } },
  ] },
  { id: 'relation', ask: (n) => `Kven er ${n} for deg?`, options: [
    { label: 'Partnar', value: 'partnar', save: { relation: 'Partnar' } },
    { label: 'Mor/far', value: 'forelder', save: { relation: 'Forelder' } },
    { label: 'Barn', value: 'barnet mitt', save: { relation: 'Barn' } },
    { label: 'Søsken', value: 'søsken', save: { relation: 'Søsken' } },
    { label: 'Besteforelder', value: 'besteforelder', save: { relation: 'Besteforelder' } },
    { label: 'Anna familie', value: 'familie' },
    { label: 'Ven', value: 'ven', save: { relation: 'Ven' } },
    { label: 'Kollega', value: 'kollega', save: { relation: 'Kollega' } },
  ] },
  { id: 'budget', ask: () => 'Kva vil du bruke?', options: [
    { label: 'Under 200', value: 'under 200 kr' },
    { label: '200–500', value: '200 til 500 kr' },
    { label: '500–1000', value: '500 til 1000 kr' },
    { label: 'Over 1000', value: 'over 1000 kr' },
  ] },
  { id: 'type', ask: () => 'Kva slags gåve?', options: [
    { label: 'Ein ting', value: 'ein fysisk ting' },
    { label: 'Ei oppleving', value: 'ei oppleving' },
    { label: 'Noko praktisk', value: 'noko praktisk' },
    { label: 'Noko personleg', value: 'noko personleg' },
    { label: 'Lage sjølv', value: 'noko ein kan lage sjølv' },
  ] },
  { id: 'interests', ask: (n) => `Kva er ${n} glad i?`, text: 'Fjellturar, baking, gaming …' },
];

const LABELS: Record<string, string> = { age: 'Alder', gender: 'Kjønn', relation: 'Relasjon', budget: 'Budsjett', type: 'Type gåve', interests: 'Interesser' };

function Guide({ person, onDone, onSkipAll }: { person?: Person; onDone: (answers: Record<string, string>, save: Partial<Person>) => void; onSkipAll: () => void }) {
  const known = (id: string) => {
    if (!person) return false;
    if (id === 'age') return !!person.birth_year || !!person.age_group;
    if (id === 'gender') return !!person.gender;
    if (id === 'relation') return !!person.relation;
    if (id === 'interests') return !!person.interests;
    return false;
  };
  const questions = QUESTIONS.filter((q) => !known(q.id));
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [save, setSave] = useState<Partial<Person>>({});
  const [text, setText] = useState('');
  const name = person ? firstName(person.name) : 'personen';
  const q = questions[index];

  const advance = (value?: string, extra?: Partial<Person>) => {
    const nextAnswers = value ? { ...answers, [q.id]: value } : answers;
    const nextSave = extra ? { ...save, ...extra } : save;
    setAnswers(nextAnswers);
    setSave(nextSave);
    setText('');
    if (index + 1 >= questions.length) onDone(nextAnswers, nextSave);
    else setIndex(index + 1);
  };

  if (!q) return null;
  return (
    <section className="guide" aria-live="polite">
      <div className="guide-dots" aria-hidden="true">{questions.map((x, i) => <i key={x.id} className={i < index ? 'done' : i === index ? 'now' : ''} />)}</div>
      <div className="guide-card" key={q.id}>
        <small>Valfritt</small>
        <h2>{q.ask(name)}</h2>
        {q.options && <div className="guide-options">{q.options.map((o) => <button key={o.label} className="filter" onClick={() => advance(o.value, o.save)}>{o.label}</button>)}</div>}
        {q.text && (
          <form className="guide-text" onSubmit={(e) => { e.preventDefault(); advance(text.trim() || undefined, text.trim() ? { interests: text.trim() } : undefined); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={q.text} autoFocus aria-label={q.ask(name)} />
            <button className="icon-btn primary" aria-label="Neste"><ArrowRight size={18} /></button>
          </form>
        )}
        <div className="guide-foot">
          <button className="text-btn" onClick={() => advance()}>Hopp over</button>
          <button className="text-btn" onClick={() => (Object.keys(answers).length ? onDone(answers, save) : onSkipAll())}>{Object.keys(answers).length ? 'Finn gåver no' : 'Spør fritt i staden'}</button>
        </div>
      </div>
    </section>
  );
}

export function NissenPage() {
  const data = useData();
  const { addGift } = useGifts();
  const [params] = useSearchParams();
  const [personId, setPersonId] = useState(params.get('person') ?? '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [guiding, setGuiding] = useState(true);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const chatRun = useRef(0);
  const person = data.peopleById.get(personId);
  const first = firstName(person?.name);

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  const ask = async (content: string) => {
    const clean = content.trim();
    if (!clean || busy) return;
    const next: Message[] = [...messages, { id: ++nextId, role: 'user', content: clean }];
    const run = ++chatRun.current;
    setMessages(next);
    setText('');
    setBusy(true);
    setError('');
    try {
      const res = await pb.send<{ reply: string; suggestions: Suggestion[]; findShops?: boolean }>('/api/jul/ai/chat', {
        method: 'POST',
        body: { messages: next.map(({ role, content: c }) => ({ role, content: c })), personId, budget: 0 },
      });
      if (run !== chatRun.current) return;
      const reply: Message = { id: ++nextId, role: 'assistant', content: res.reply || 'Her er nokre idear:', suggestions: res.suggestions, personId, finding: !!res.findShops && res.suggestions.length > 0 };
      setMessages([...next, reply]);
      if (reply.finding) void findShops(reply);
    } catch (err) {
      if (run === chatRun.current) setError(errorText(err, 'Nissen svarte ikkje. Prøv igjen.'));
    } finally {
      if (run === chatRun.current) setBusy(false);
    }
  };

  // Butikkar og lenker kjem etter det raske svaret. Du kan halde fram å skrive medan Nissen leitar.
  const findShops = async (reply: Message) => {
    let shops: ShopMatch[] = [];
    try {
      shops = (await pb.send<{ shops: ShopMatch[] }>('/api/jul/ai/shops', { method: 'POST', body: { suggestions: reply.suggestions } })).shops ?? [];
    } catch { /* Forslaga står seg utan butikk, med søkeknapp. */ }
    setMessages((list) => list.map((m) => {
      if (m.id !== reply.id) return m;
      const suggestions = (m.suggestions ?? []).map((s, i) => {
        const hit = shops.find((x) => x.index === i);
        return hit ? { ...s, url: hit.url, shop: hit.shop || s.shop, price_estimate: hit.price > 0 ? hit.price : s.price_estimate } : s;
      });
      return { ...m, suggestions, finding: false };
    }));
  };

  const finishGuide = (answers: Record<string, string>, save: Partial<Person>) => {
    setGuiding(false);
    const lines = Object.entries(answers).map(([k, v]) => `${LABELS[k]}: ${v}`);
    void ask(`Finn gode gåveidear${person ? ` til ${first}` : ''}.${lines.length ? `\n${lines.join('\n')}` : ''}`);
    // Svara blir lagra i mitt private notat om personen. Ingen andre ser dei.
    if (person && Object.keys(save).length && person.user !== data.me.id) {
      const { relation, gender, age_group, interests } = save;
      void saveNote(data, person.id, { relation, gender, age_group, interests }).catch(() => undefined);
    }
  };

  const choosePerson = (id: string) => {
    chatRun.current++; // Eit svar som er på veg, gjaldt den førre personen.
    setBusy(false);
    setPersonId(id);
    setMessages([]);
    setError('');
    setGuiding(true);
  };

  if (!data.config.aiEnabled) {
    return (
      <div className="page">
        <header className="page-head"><h1>Nissen</h1></header>
        <Empty title="Gåveforslag er slått av">Administrator kan slå på Nissen under Innstillingar.</Empty>
      </div>
    );
  }

  const showGuide = guiding && messages.length === 0 && !busy;
  return (
    <div className="page nisse">
      <header className="page-head">
        <h1>Nissen</h1>
      </header>

      <div className="person-select" role="group" aria-label="Kven er gåva til?">
        <button className={`chip ${!personId ? 'on' : ''}`} aria-pressed={!personId} onClick={() => choosePerson('')}>Nokon andre</button>
        {data.people.filter((p) => p.user !== data.me.id).sort((a, b) => Number(isRecipient(data, b.id)) - Number(isRecipient(data, a.id))).map((p) => (
          <button key={p.id} className={`chip ${personId === p.id ? 'on' : ''}`} aria-pressed={personId === p.id} onClick={() => choosePerson(p.id)}>
            <Avatar person={p} size={22} /> {firstName(p.name)}
          </button>
        ))}
      </div>

      <div className="chat">
        {showGuide && <Guide key={personId} person={person} onDone={finishGuide} onSkipAll={() => setGuiding(false)} />}
        {!showGuide && messages.length === 0 && !busy && (
          <div className="chat-intro">
            <Sparkles size={26} />
            <p>{person ? `Kva leitar du etter til ${first}?` : 'Kven leitar du etter gåve til?'}</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <p>{m.content}</p>
            {m.suggestions && m.suggestions.length > 0 && (
              <div className="suggestions">
                {m.suggestions.map((s, j) => (
                  <article className="suggestion" key={j} style={{ animationDelay: `${j * 60}ms` }}>
                    <h4>{s.title}</h4>
                    <p>{s.why}</p>
                    <div className="suggestion-meta">
                      {s.price_estimate > 0 && <strong>{s.url ? kr(s.price_estimate) : `ca. ${kr(s.price_estimate)}`}</strong>}
                      {s.shop && <span>{s.shop}</span>}
                      {m.finding && <span className="finding"><Loader2 size={13} className="spin" /> Finn butikk …</span>}
                    </div>
                    <div className="suggestion-actions">
                      <button className="btn small primary" onClick={() => addGift({ kind: 'plan', title: s.title, price: s.price_estimate, shop: s.shop, url: s.url, note: s.why, recipients: m.personId ? [m.personId] : [] })}>
                        <Plus size={15} /> Legg til
                      </button>
                      {s.url ? (
                        <a className="btn small ghost" href={s.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> Sjå</a>
                      ) : m.finding ? null : (
                        <a className="btn small ghost" href={`https://www.prisjakt.no/search?search=${encodeURIComponent(s.search || s.title)}`} target="_blank" rel="noreferrer noopener"><Search size={14} /> Søk</a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant thinking"><Loader2 size={17} className="spin" /> Nissen leitar i verkstaden …</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div ref={end} />
      </div>

      {!showGuide && (
        <form className="chat-input" onSubmit={(e: FormEvent) => { e.preventDefault(); void ask(text); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Skriv ei melding" aria-label="Melding til Nissen" maxLength={4000} />
          <button className="icon-btn primary" aria-label="Send" disabled={busy || !text.trim()}><Send size={19} /></button>
        </form>
      )}
    </div>
  );
}
