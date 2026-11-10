import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, Copy, Globe2, Lock, Plus, Settings2, Users } from 'lucide-react';
import { useData } from '../data';
import { GiftView, useGifts, ViewToggle } from '../gifts';
import { badAmount, canEditList, errorText, isJul, kr, listLabel, OCCASIONS, parseAmount, pb, STATUSES, type GiftList, type Occasion } from '../lib';
import { Avatar, Empty, Field, Segmented, Sheet, Switch, useConfirm, useToast } from '../ui';

const VIS = { private: { label: 'Privat', icon: Lock }, family: { label: 'Heile familien', icon: Globe2 }, shared: { label: 'Delt', icon: Users } };

function ListCard({ list }: { list: GiftList }) {
  const data = useData();
  const gifts = data.gifts.filter((g) => g.list === list.id);
  const total = gifts.reduce((s, g) => s + g.price, 0);
  const Icon = VIS[list.visibility].icon;
  const owner = data.people.find((p) => p.user === list.owner);
  const subject = list.person ? data.peopleById.get(list.person) : owner;
  const members = [...list.editors, ...list.viewers].map((u) => data.people.find((p) => p.user === u)).filter(Boolean);
  return (
    <Link to={`/lister/${list.id}`} className={`list-card kind-${list.kind}`}>
      <span className="list-kind">{listLabel(list)}</span>
      <strong>{list.name}</strong>
      <span className="list-sub">{subject && list.kind === 'wishes' ? subject.name : `${gifts.length} ${gifts.length === 1 ? 'gåve' : 'gåver'}`}{total > 0 && ` · ${kr(total)}`}</span>
      <span className="list-foot">
        <span className="list-vis"><Icon size={14} /> {VIS[list.visibility].label}</span>
        <span className="stack">{members.slice(0, 4).map((p) => <Avatar key={p!.id} person={p} size={24} />)}</span>
      </span>
    </Link>
  );
}

function ListForm({ onDone }: { onDone: (l: GiftList) => void }) {
  const data = useData();
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'plan' | 'wishes'>('plan');
  const [person, setPerson] = useState(data.myPerson?.id ?? '');
  const [occasion, setOccasion] = useState<Occasion>('jul');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await pb.collection('lists').create<GiftList>({
        name: name.trim(), kind, owner: data.me.id, year: data.season,
        occasion, event_date: occasion === 'jul' ? '' : date,
        visibility: 'private', person: kind === 'wishes' ? person : '',
      });
      await data.reload('lists');
      onDone(created);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={submit}>
      <Segmented label="Type liste" value={kind} onChange={setKind} options={[{ id: 'plan', label: 'Gåveplan' }, { id: 'wishes', label: 'Ønskeliste' }]} />
      <Field label="Namn"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} data-initial-focus="true" placeholder={kind === 'plan' ? 'Søskengåve til mamma' : 'Ønska til Emil'} /></Field>
      <div className="row-2">
        <Field label="Høve">
          <select value={occasion} onChange={(e) => setOccasion(e.target.value as Occasion)}>
            {OCCASIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        {occasion !== 'jul' && <Field label="Dato"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
      </div>
      {kind === 'wishes' && (
        <Field label="Kven ønskjer seg?" hint="Du kan lage ønskelister for dei som ikkje har konto, som barn.">
          <select value={person} onChange={(e) => setPerson(e.target.value)} required>
            {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      <div className="form-actions"><button className="btn primary" disabled={busy}>Opprett</button></div>
    </form>
  );
}

export function ListsPage() {
  const data = useData();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const jul = data.lists.filter((l) => isJul(l));
  const current = jul.filter((l) => l.kind === 'wishes' || l.year === data.season);
  const mine = current.filter((l) => l.owner === data.me.id);
  const shared = current.filter((l) => l.owner !== data.me.id && l.visibility === 'shared');
  const family = current.filter((l) => l.owner !== data.me.id && l.visibility === 'family');
  const others = data.lists.filter((l) => !isJul(l)).sort((a, b) => (a.event_date || '9').localeCompare(b.event_date || '9'));
  const old = jul.filter((l) => l.kind === 'plan' && l.year !== data.season).sort((a, b) => b.year - a.year);
  const group = (title: string, items: GiftList[]) => items.length > 0 && (
    <section key={title}>
      <div className="section-head"><h2>{title}</h2></div>
      <div className="list-grid">{items.map((l) => <ListCard key={l.id} list={l} />)}</div>
    </section>
  );
  return (
    <div className="page">
      <header className="page-head">
        <h1>Lister</h1>
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={18} /> Ny liste</button>
      </header>
      {group('Mine', mine)}
      {group('Delt med meg', shared)}
      {group('Familien', family)}
      {group('Andre høve', others)}
      {group('Tidlegare år', old)}
      {data.lists.length === 0 && <Empty title="Ingen lister enno" />}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Ny liste" protect>
        {adding && <ListForm onDone={(l) => { setAdding(false); navigate(`/lister/${l.id}`); }} />}
      </Sheet>
    </div>
  );
}

/** Ei lenke for dei som ikkje har konto. Slår ein henne av og på igjen, blir det ei ny lenke. */
function ShareLink({ list }: { list: GiftList }) {
  const data = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const url = list.share_token ? `${window.location.origin}/delt/${list.share_token}` : '';
  const toggle = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await pb.send(`/api/jul/lists/${list.id}/share`, { method: 'POST', body: { enabled } });
      await data.reload('lists');
    } catch (err) { toast(errorText(err)); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast('Lenka er kopiert'); } catch { toast(url); }
  };
  return (
    <div className="share-link">
      <Switch checked={!!url} onChange={(v) => void toggle(v)} label="Del med lenke" hint="For dei som ikkje har konto. Dei kan sjå ønska og reservere." />
      {url && (
        <>
          <div className="copy-row">
            <input readOnly value={url} aria-label="Delingslenke" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn ghost" onClick={() => void copy()}><Copy size={16} /> Kopier</button>
          </div>
          <p className="field-hint">Alle med lenka kan sjå lista til du slår av delinga.</p>
        </>
      )}
    </div>
  );
}

function ShareForm({ list, onDone }: { list: GiftList; onDone: () => void }) {
  const data = useData();
  const toast = useToast();
  const isOwner = list.owner === data.me.id;
  const [name, setName] = useState(list.name);
  const [budget, setBudget] = useState(list.budget ? String(list.budget) : '');
  const [visibility, setVisibility] = useState(list.visibility);
  const [roles, setRoles] = useState<Record<string, 'none' | 'viewer' | 'editor'>>(() => {
    const r: Record<string, 'none' | 'viewer' | 'editor'> = {};
    list.viewers.forEach((u) => { r[u] = 'viewer'; });
    list.editors.forEach((u) => { r[u] = 'editor'; });
    return r;
  });
  const members = data.people.filter((p) => p.user && p.user !== list.owner);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (badAmount(budget)) { toast('Budsjettet må vere eit tal, til dømes 500.'); return; }
    try {
      const body: Record<string, unknown> = { name: name.trim(), budget: parseAmount(budget) };
      if (isOwner) {
        body.visibility = visibility;
        const pick = (role: string) => (visibility === 'shared' ? Object.keys(roles).filter((u) => roles[u] === role) : []);
        body.editors = pick('editor');
        body.viewers = pick('viewer');
      }
      await pb.collection('lists').update(list.id, body);
      await data.reload('lists');
      toast('Lagra');
      onDone();
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <form className="form" onSubmit={save}>
      <Field label="Namn"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></Field>
      <Field label="Budsjett (kr)"><input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field>
      {isOwner && (
        <>
          <div className="field">
            <span className="field-label">Kven kan sjå lista?</span>
            <Segmented label="Synlegheit" value={visibility} onChange={setVisibility} options={[{ id: 'private', label: 'Berre eg' }, { id: 'shared', label: 'Utvalde' }]} />
          </div>
          {visibility === 'shared' && (
            <div className="member-list">
              {members.length === 0 && <p className="muted">Ingen andre har konto enno. Du finn invitasjonslenka under Innstillingar.</p>}
              {members.map((p) => (
                <div className="member" key={p.id}>
                  <Avatar person={p} size={34} /><span>{p.name}</span>
                  <Segmented label={`Tilgang for ${p.name}`} value={roles[p.user] ?? 'none'} onChange={(v) => setRoles((r) => ({ ...r, [p.user]: v }))} options={[{ id: 'none', label: 'Ingen' }, { id: 'viewer', label: 'Sjå' }, { id: 'editor', label: 'Endre' }]} />
                </div>
              ))}
              <p className="field-hint">Gåver blir aldri synlege for den dei er meint til, sjølv om vedkomande har tilgang til lista.</p>
            </div>
          )}
          {list.kind === 'wishes' && <ShareLink list={list} />}
        </>
      )}
      <div className="form-actions"><button className="btn primary">Lagre</button></div>
    </form>
  );
}

export function ListPage() {
  const { id = '' } = useParams();
  const data = useData();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { addGift } = useGifts();
  const [settings, setSettings] = useState(false);
  const [person, setPerson] = useState('');
  const [status, setStatus] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const list = data.listsById.get(id);
  const inList = useMemo(() => data.allGifts.filter((g) => g.list === id).sort((a, b) => b.priority - a.priority || b.created.localeCompare(a.created)), [data.allGifts, id]);
  const all = inList.filter((g) => !g.archived);
  const archived = inList.filter((g) => g.archived);
  if (!list) return <div className="page"><Empty title="Fann ikkje lista" action={<Link className="btn ghost" to="/lister">Til Lister</Link>} /></div>;

  const editable = canEditList(list, data.me.id);
  const isOwner = list.owner === data.me.id;
  const recipients = [...new Set(all.flatMap((g) => g.recipients))];
  const viewing = showArchived && archived.length > 0;
  const shown = viewing ? archived : all.filter((g) => (!person || g.recipients.includes(person)) && (!status || (g.status || 'idea') === status));
  const total = all.reduce((s, g) => s + g.price, 0);
  const VisIcon = VIS[list.visibility].icon;
  const pct = list.budget > 0 ? Math.min(100, Math.round((total / list.budget) * 100)) : 0;

  const remove = async () => {
    if (!(await confirm({ title: `Slette «${list.name}»?`, body: 'Alle gåvene i lista blir òg sletta.', action: 'Slett', danger: true }))) return;
    try {
      await pb.collection('lists').delete(list.id);
      await data.reload('lists');
      navigate('/lister');
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <div className="page">
      <Link className="back" to="/lister"><ArrowLeft size={18} /> Lister</Link>
      <header className="page-head">
        <div>
          <p className="eyebrow dark">{listLabel(list)}</p>
          <h1>{list.name}</h1>
          <p className="muted list-meta"><VisIcon size={14} /> {VIS[list.visibility].label} · {all.length} {all.length === 1 ? 'gåve' : 'gåver'}{total > 0 && ` · ${kr(total)}`}{list.budget > 0 && ` av ${kr(list.budget)}`}</p>
          {list.budget > 0 && <div className="budget-bar"><i style={{ width: `${pct}%` }} className={total > list.budget ? 'over' : ''} /></div>}
        </div>
        {editable && <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Innstillingar og deling"><Settings2 size={20} /></button>}
      </header>

      <div className="action-row">
        {editable && <button className="btn primary" onClick={() => addGift({ listId: list.id, kind: list.kind })}><Plus size={18} /> Legg til</button>}
        {all.length > 0 && <ViewToggle />}
        {archived.length > 0 && (
          <button type="button" className={`filter archive-toggle ${viewing ? 'on' : ''}`} aria-pressed={viewing} onClick={() => setShowArchived(!viewing)}><Archive size={14} /> Arkivert ({archived.length})</button>
        )}
      </div>

      {list.kind === 'plan' && all.length > 0 && !viewing && (
        <div className="filters">
          <button className={`filter ${!status ? 'on' : ''}`} onClick={() => setStatus('')}>Alle</button>
          {STATUSES.map((s) => <button key={s.id} className={`filter status-filter st-${s.id} ${status === s.id ? 'on' : ''}`} onClick={() => setStatus(status === s.id ? '' : s.id)}>{s.label}</button>)}
          {recipients.length > 1 && <span className="filter-sep" />}
          {recipients.length > 1 && recipients.map((r) => (
            <button key={r} className={`filter ${person === r ? 'on' : ''}`} onClick={() => setPerson(person === r ? '' : r)}>{data.peopleById.get(r)?.name}</button>
          ))}
        </div>
      )}

      {shown.length === 0
        ? <Empty title={all.length ? 'Ingen gåver her' : 'Lista er tom'}>{all.length ? 'Prøv eit anna filter.' : undefined}</Empty>
        : <GiftView gifts={shown} group={list.kind === 'plan' && !viewing} />}

      <Sheet open={settings} onClose={() => setSettings(false)} title="Liste og deling">
        {settings && <ShareForm list={list} onDone={() => setSettings(false)} />}
        {settings && isOwner && <button className="btn ghost danger full spaced" onClick={remove}>Slett lista</button>}
      </Sheet>
    </div>
  );
}
