import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, ExternalLink, Loader2, Plus, Search, Send, Sparkles } from 'lucide-react';
import { isRecipient, useData } from '../data';
import { useGifts } from '../gifts';
import { errorText, firstName, kr, pb, type Person } from '../lib';
import { Avatar, Empty } from '../ui';

interface Suggestion { title: string; why: string; price_estimate: number; shop: string; url: string; search: string }
interface Message { role: 'user' | 'assistant'; content: string; suggestions?: Suggestion[]; personId?: string }

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
    const next: Message[] = [...messages, { role: 'user', content: clean }];
    const run = ++chatRun.current;
    setMessages(next);
    setText('');
    setBusy(true);
    setError('');
    try {
      const res = await pb.send<{ reply: string; suggestions: Suggestion[] }>('/api/jul/ai/chat', {
        method: 'POST',
        body: { messages: next.map(({ role, content: c }) => ({ role, content: c })), personId, budget: 0 },
      });
      if (run !== chatRun.current) return;
      setMessages([...next, { role: 'assistant', content: res.reply || 'Her er nokre idear:', suggestions: res.suggestions, personId }]);
    } catch (err) {
      if (run === chatRun.current) setError(errorText(err, 'Nissen svarte ikkje. Prøv igjen.'));
    } finally {
      if (run === chatRun.current) setBusy(false);
    }
  };

  const finishGuide = (answers: Record<string, string>, save: Partial<Person>) => {
    setGuiding(false);
    const lines = Object.entries(answers).map(([k, v]) => `${LABELS[k]}: ${v}`);
    void ask(`Finn gode gåveidear${person ? ` til ${first}` : ''}.${lines.length ? `\n${lines.join('\n')}` : ''}`);
    if (person && Object.keys(save).length && (!person.user || person.user === data.me.id || person.created_by === data.me.id)) {
      void pb.collection('people').update(person.id, save).then(() => data.reload('people')).catch(() => undefined);
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
        <Empty title="Nissen er ikkje på jobb enno">Han vaknar når administrator har lagt inn OpenAI-nøkkelen og slått han på.</Empty>
      </div>
    );
  }

  const showGuide = guiding && messages.length === 0 && !busy;
  return (
    <div className="page nisse">
      <header className="page-head">
        <div><h1>Nissen</h1><p className="muted">Finn gåva saman med han</p></div>
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
            <p>{person ? `Kva leitar du etter til ${first}?` : 'Spør i veg.'}</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <p>{m.content}</p>
            {m.suggestions && m.suggestions.length > 0 && (
              <div className="suggestions">
                {m.suggestions.map((s, j) => (
                  <article className="suggestion" key={j} style={{ animationDelay: `${j * 60}ms` }}>
                    <h4>{s.title}</h4>
                    <p>{s.why}</p>
                    <div className="suggestion-meta">
                      {s.price_estimate > 0 && <strong>ca. {kr(s.price_estimate)}</strong>}
                      {s.shop && <span>{s.shop}</span>}
                    </div>
                    <div className="suggestion-actions">
                      <button className="btn small primary" onClick={() => addGift({ kind: 'plan', title: s.title, price: s.price_estimate, shop: s.shop, url: s.url, note: s.why, recipients: m.personId ? [m.personId] : [] })}>
                        <Plus size={15} /> Legg til
                      </button>
                      {s.url ? (
                        <a className="btn small ghost" href={s.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> Sjå</a>
                      ) : (
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
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={messages.length ? 'Meir av dette, eller noko anna?' : 'Spør Nissen …'} aria-label="Melding til Nissen" maxLength={4000} />
          <button className="icon-btn primary" aria-label="Send" disabled={busy || !text.trim()}><Send size={19} /></button>
        </form>
      )}
    </div>
  );
}
