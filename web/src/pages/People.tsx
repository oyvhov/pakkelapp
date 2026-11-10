import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Camera, Check, Share2, Eye, Gift, Lock, Pencil, Plus, Sparkles } from 'lucide-react';
import { audienceOf, giftsFor, saveNote, myWishLists, isDone, isMarked, isRecipient, markSeen, myGifts, myMark, newLabel, newWishCount, setBudget, setDone, setRecipient, useData, useSeen } from '../data';
import { useCrop } from '../crop';
import { GiftView, useGifts, ViewToggle } from '../gifts';
import { badAmount, COLORS, errorText, firstName, haptic, kr, parseAmount, pb, shrinkImage, type Person } from '../lib';
import { Avatar, Empty, Field, GiftImage, Segmented, Sheet, Switch, useConfirm, useToast } from '../ui';

const RELATIONS = ['Mamma', 'Pappa', 'Barn', 'Søsken', 'Besteforelder', 'Tante/onkel', 'Nevø/niese', 'Svigers', 'Ven'];

export function PersonForm({ person, onDone }: { person?: Person; onDone: (p?: Person) => void }) {
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(person?.name ?? '');
  const [relation, setRelation] = useState(person?.relation ?? '');
  const [age, setAge] = useState(person?.birth_year ? String(new Date().getFullYear() - person.birth_year) : '');
  const [gender, setGender] = useState<Person['gender']>(person?.gender ?? '');
  const startBudget = person ? myMark(data, person.id)?.budget ?? 0 : 0;
  const [budget, setBudgetText] = useState(startBudget ? String(startBudget) : '');
  const [interests, setInterests] = useState(person?.interests ?? '');
  const [sizes, setSizes] = useState(person?.sizes ?? '');
  const [color, setColor] = useState(person?.color || COLORS[data.people.length % COLORS.length]);
  const [vipps, setVipps] = useState(person?.vipps ?? '');
  const startCovered = person?.covered_by || person?.covered_request || '';
  const [coveredBy, setCoveredBy] = useState(startCovered);
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const crop = useCrop();
  const [photoUrl, setPhotoUrl] = useState('');
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const noAccount = !person?.user;
  const coverOptions = noAccount
    ? data.people.filter((p) => p.id === data.myPerson?.id || p.id === startCovered)
    : person?.user === data.me.id ? data.people.filter((p) => p.user && p.id !== person.id) : [];
  const isSelf = !!person && person.user === data.me.id;
  // Namn, farge og Vipps er felles. Det andre om andre enn meg sjølv, ser berre eg.
  const canEditShared = !person || isSelf || person.created_by === data.me.id;
  const locked = !!person && myGifts(data, person.id).count > 0;
  const [gets, setGets] = useState(person ? isRecipient(data, person.id) : true);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (badAmount(budget)) { toast('Budsjettet må vere eit tal, til dømes 500.'); return; }
    setBusy(true);
    try {
      const ageNumber = Number(age);
      const details = {
        relation: relation.trim(), gender, interests: interests.trim(), sizes: sizes.trim(),
        birth_year: age && ageNumber >= 0 && ageNumber < 120 ? new Date().getFullYear() - ageNumber : 0,
      };
      const shared = { name: name.trim(), color, vipps: vipps.trim() };
      const image = photo ? await shrinkImage(photo) : undefined;
      let saved = person as Person;
      if (isSelf) saved = await pb.collection('people').update<Person>(person.id, { ...shared, interests: details.interests, sizes: details.sizes, gender: details.gender, birth_year: details.birth_year || null, ...(image ? { avatar: image } : {}) });
      else if (!person) saved = await pb.collection('people').create<Person>({ ...shared, created_by: data.me.id });
      else if (canEditShared) saved = await pb.collection('people').update<Person>(person.id, shared);
      if (!isSelf) {
        const changed = !person || (Object.keys(details) as (keyof typeof details)[]).some((k) => (details[k] || '') !== (person[k] || ''));
        if (changed) await saveNote(data, saved.id, details);
        if (image) {
          const mine = data.photos.find((p) => p.person === saved.id);
          if (mine) await pb.collection('photos').update(mine.id, { image });
          else await pb.collection('photos').create({ user: data.me.id, person: saved.id, image });
          await data.reload('photos');
        }
      }
      if (coveredBy !== startCovered) await pb.send('/api/jul/covered-by', { method: 'POST', body: { personId: saved.id, targetId: coveredBy } });
      await data.reload('people');
      if (!isSelf && !locked) await setRecipient(data, saved.id, gets);
      const newBudget = parseAmount(budget);
      if (!isSelf && (gets || locked) && newBudget !== startBudget) await setBudget(data, saved.id, newBudget);
      onDone(saved);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!person || !(await confirm({ title: `Fjerne ${person.name}?`, action: 'Fjern', danger: true }))) return;
    try {
      await pb.collection('people').delete(person.id);
      await data.reload('people');
      onDone();
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <div className="profile-top">
        <button type="button" className="avatar-pick" onClick={() => photoInput.current?.click()}>
          {photoUrl
            ? <span className="avatar" style={{ width: 72, height: 72 }}><img src={photoUrl} alt="" /></span>
            : <Avatar person={{ ...person, name: name || '?', color } as Person} size={72} />}
          <span>{person?.avatar || photo ? 'Byt bilete' : 'Legg til bilete'}</span>
        </button>
        <input ref={photoInput} type="file" accept="image/*" hidden aria-label="Vel bilete" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; const cut = await crop(f); if (cut) setPhoto(cut); }} />
      </div>
      <Field label="Namn"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} disabled={!canEditShared} data-initial-focus={!person} /></Field>
      {!isSelf && <p className="form-note"><Lock size={13} /> Bilete, alder, relasjon, kjønn, interesser og storleikar ser berre du.</p>}
      {!isSelf && <Switch checked={gets || locked} onChange={(v) => { if (!locked) setGets(v); }} label="Skal få gåve frå meg i år" hint={locked ? 'Du har alt ei gåve til denne personen.' : 'Berre du ser kven du har valt.'} />}
      <details className="person-details" open={!!person}>
        <summary>Fleire opplysningar</summary>
        <div className="form">
          <div className="row-2">
            <Field label="Alder"><input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} maxLength={3} placeholder="År" /></Field>
            <Field label="Relasjon">
              <input list="relasjonar" value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Mormor, nevø …" maxLength={80} />
              <datalist id="relasjonar">{RELATIONS.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
          </div>
          <div className="field">
            <span className="field-label">Kjønn</span>
            <Segmented label="Kjønn" value={gender || 'none'} onChange={(v) => setGender(v === 'none' ? '' : v as Person['gender'])} options={[{ id: 'none', label: 'Ikkje sett' }, { id: 'female', label: 'Jente / kvinne' }, { id: 'male', label: 'Gut / mann' }, { id: 'other', label: 'Anna' }]} />
          </div>
          <Field label="Interesser"><textarea rows={2} value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="Fjellturar, strikking, Formel 1 …" maxLength={2000} /></Field>
          <div className="row-2">
            <Field label="Storleikar"><input value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="M, sko 42 …" maxLength={1000} /></Field>
            {!isSelf && <Field label="Mitt budsjett" hint="Berre du ser dette."><input inputMode="numeric" value={budget} onChange={(e) => setBudgetText(e.target.value)} placeholder="kr" /></Field>}
          </div>
          {canEditShared && coverOptions.length > 0 && (
            <Field label="Kostnader går via" hint={person?.covered_request ? `Ventar på svar frå ${firstName(data.peopleById.get(person.covered_request)?.name)}.` : noAccount ? 'Vel deg sjølv om du betaler for denne personen, til dømes eit barn.' : 'For par og hushald. Den andre må seie ja før det gjeld.'}>
              <select value={coveredBy} onChange={(e) => setCoveredBy(e.target.value)}>
                <option value="">{noAccount ? 'Personen sjølv' : 'Meg sjølv'}</option>
                {coverOptions.map((p) => <option key={p.id} value={p.id}>{p.id === data.myPerson?.id ? `Meg (${firstName(p.name)})` : p.name}</option>)}
              </select>
            </Field>
          )}
          {canEditShared && <Field label="Vipps-nummer"><input inputMode="tel" value={vipps} onChange={(e) => setVipps(e.target.value)} maxLength={30} /></Field>}
          {canEditShared && <div className="field">
            <span className="field-label">Farge</span>
            <div className="swatches">
              {COLORS.map((c) => (
                <button key={c} type="button" className={color === c ? 'on' : ''} style={{ background: c }} aria-label={`Farge ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}>
                  {color === c && <Check size={15} color="#fff" />}
                </button>
              ))}
            </div>
          </div>}
        </div>
      </details>
      <div className="form-actions spread">
        {person && !person.user && person.created_by === data.me.id ? <button type="button" className="btn ghost danger" onClick={() => void remove()}>Fjern</button> : <span />}
        <button className="btn primary" disabled={busy}>{person ? 'Lagre' : 'Legg til'}</button>
      </div>
    </form>
  );
}

function RecipientToggle({ personId, name }: { personId: string; name: string }) {
  const data = useData();
  const toast = useToast();
  const has = myGifts(data, personId).count > 0;
  const on = has || isMarked(data, personId);
  const toggle = async () => {
    haptic();
    try { await setRecipient(data, personId, !on); } catch (err) { toast(errorText(err)); void data.reload('recipients'); }
  };
  return (
    <button
      type="button" className={`get-toggle ${on ? 'on' : ''}`} disabled={has} aria-pressed={on}
      aria-label={`${name} skal få gåve`} title={has ? 'Du har alt ei gåve til denne personen' : on ? 'Ta av lista' : 'Skal få gåve'}
      onClick={() => void toggle()}
    >
      {on ? <Check size={18} strokeWidth={2.6} /> : <Gift size={18} />}
    </button>
  );
}

/** Rett inn til ønska mine, frå Oversikt og Folk. */
export function MeCard({ fromHome }: { fromHome?: boolean }) {
  const data = useData();
  const me = data.myPerson;
  if (!me) return null;
  const count = giftsFor(data, me.id).wishes.length;
  const list = myWishLists(data)[0];
  return (
    <Link className="me-card" to={`/folk/${me.id}`} state={fromHome ? { from: 'home' } : undefined}>
      <Avatar person={me} size={44} large />
      <span className="me-card-text">
        <strong>Mine ønske</strong>
        <small>{count === 0 ? 'Ingen ønske enno' : `${count} ønske`}{list && ` · ${audienceOf(data, list).short}`}</small>
      </span>
      <ArrowRight size={18} />
    </Link>
  );
}

/** Svarar på det ein lurer på: kven er det som faktisk ser det eg ønskjer meg? */
function WishAudience() {
  const data = useData();
  const lists = myWishLists(data);
  if (lists.length === 0) return null;
  return (
    <section className="panel who-sees">
      <h2><Eye size={17} /> Kven ser ønska dine?</h2>
      {lists.map((list) => {
        const who = audienceOf(data, list);
        return (
          <Link key={list.id} className="who-row" to={`/lister/${list.id}?del=1`}>
            <span className="who-text"><strong>{who.label}</strong><small>{lists.length > 1 && `${list.name}. `}{who.hint}</small></span>
            {who.people.length > 0 && <span className="stack">{who.people.slice(0, 5).map((p) => <Avatar key={p.id} person={p} size={28} />)}</span>}
            <span className="btn small primary who-edit"><Share2 size={14} /> Del</span>
          </Link>
        );
      })}
      <p className="ps-note">Vil du dele berre eitt ønske, opnar du ønsket og trykkjer Del. Du ser ikkje kven som har reservert eller kjøpt ei gåve til deg.</p>
    </section>
  );
}

/** Profilbiletet på personsida. Trykk på det for å byte, om du har lov til å endre personen. */
function PersonPhoto({ person, canEdit }: { person: Person; canEdit: boolean }) {
  const data = useData();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const crop = useCrop();
  // Bilete eg legg inn av andre, ser berre eg. Har personen eige bilete, blir det brukt.
  const privateOnly = !canEdit;
  const mine = data.photos.find((p) => p.person === person.id);
  if (privateOnly && person.avatar) return <Avatar person={person} size={84} large />;
  const removePrivate = async (id: string) => {
    try {
      await pb.collection('photos').delete(id);
      await data.reload('photos');
    } catch (err) { toast(errorText(err, 'Kunne ikkje fjerne biletet.')); }
  };
  const upload = async (picked?: File) => {
    const file = picked && await crop(picked);
    if (!file) return;
    setBusy(true);
    try {
      const image = await shrinkImage(file);
      if (!privateOnly) {
        await pb.collection('people').update(person.id, { avatar: image });
        await data.reload('people');
      } else {
        const saved = mine
          ? await pb.collection('photos').update(mine.id, { image })
          : await pb.collection('photos').create({ user: data.me.id, person: person.id, image });
        await data.reload('photos');
        toast('Berre du ser dette biletet.', { label: 'Fjern', onClick: () => void removePrivate(saved.id) });
      }
    } catch (err) {
      toast(errorText(err, 'Kunne ikkje lagre biletet.'));
    } finally {
      setBusy(false);
    }
  };
  const label = privateOnly
    ? `${mine ? 'Byt' : 'Legg til'} bilete av ${firstName(person.name)} som berre du ser`
    : `${person.avatar ? 'Byt' : 'Legg til'} bilete av ${firstName(person.name)}`;
  return (
    <>
      <button type="button" className={`photo-pick${privateOnly ? ' private' : ''}`} disabled={busy} onClick={() => input.current?.click()} aria-label={label} title={privateOnly ? 'Berre du ser dette biletet' : undefined}>
        <Avatar person={person} size={84} large />
        <i aria-hidden="true">{privateOnly ? <Lock size={13} /> : <Camera size={14} />}</i>
      </button>
      <input ref={input} type="file" accept="image/*" hidden aria-label="Vel bilete" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
    </>
  );
}

function PersonRow({ personId }: { personId: string }) {
  const data = useData();
  const person = data.peopleById.get(personId)!;
  const mine = myGifts(data, personId);
  const chosen = isRecipient(data, personId);
  const budget = myMark(data, personId)?.budget ?? 0;
  const seen = useSeen();
  const fresh = newWishCount(data, seen, personId);
  const gifts = [...mine.planned, ...mine.claimed];
  // Ringen rundt biletet viser kor mykje av gåvene som er sikra.
  const progress = isDone(data, personId) ? 100 : mine.count > 0 ? (mine.secured / mine.count) * 100 : 0;
  return (
    <div className="person-card">
      <Link to={`/folk/${person.id}`} className="person-link">
        <span className="person-face" style={{ '--p': `${progress}%` } as CSSProperties}><Avatar person={person} size={48} large /></span>
        <span className="person-card-text">
          <strong>{person.name}{fresh > 0 && <b className="new-badge">{newLabel(fresh)}</b>}</strong>
          <small>{person.relation || (person.user ? 'Med i appen' : 'Utan konto')}</small>
        </span>
        {gifts.length > 0 && (
          <span className="pr-thumbs person-thumbs" aria-hidden="true">
            {gifts.slice(0, 3).map((g) => <span className="pr-thumb" key={g.id}><GiftImage gift={g} /></span>)}
            {gifts.length > 3 && <span className="pr-more">+{gifts.length - 3}</span>}
          </span>
        )}
        {chosen && (
          <span className="person-card-state">
            {isDone(data, personId)
              ? <span className="pill pill-bought"><Check size={12} strokeWidth={3} /> Fullført</span>
              : <span className={`pill ${mine.secured ? 'pill-bought' : mine.ideas ? '' : 'pill-missing'}`}>{mine.secured ? `${mine.secured} sikra` : mine.ideas ? `${mine.ideas} ${mine.ideas > 1 ? 'idear' : 'idé'}` : 'Ingen gåve enno'}</span>}
            {budget > 0 && <small className={mine.share > budget ? 'over-budget' : ''}>{kr(mine.share)} av {kr(budget)}</small>}
          </span>
        )}
      </Link>
      {!data.fest && <RecipientToggle personId={person.id} name={person.name} />}
    </div>
  );
}

export function PeoplePage() {
  const data = useData();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
  const others = data.people.filter((p) => p.user !== data.me.id).sort(byName);
  const chosen = others.filter((p) => isRecipient(data, p.id));
  const rest = others.filter((p) => !isRecipient(data, p.id));
  const lastYear = data.recipients.filter((r) => r.year === data.season - 1 && data.peopleById.has(r.person));
  const reuse = async () => {
    try {
      await Promise.all(lastYear.map((r) => pb.collection('recipients').create({ user: data.me.id, person: r.person, year: data.season })));
      await data.reload('recipients');
    } catch (err) { toast(errorText(err)); }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Folk</h1>
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={18} /> Legg til</button>
      </header>
      <MeCard />
      <section>
        <div className="section-head"><h2>Skal få gåve frå meg{chosen.length > 0 && ` (${chosen.length})`}</h2></div>
        {chosen.length === 0 ? data.fest ? (
          <Empty title="Ingen gåver på gang">Gåver til bursdagar og andre feiringar dukkar opp her.</Empty>
        ) : (
          <Empty title="Ingen valt enno" action={lastYear.length > 0 ? <button className="btn ghost" onClick={() => void reuse()}>Bruk same folk som i fjor</button> : undefined}>Trykk på gåveikonet ved den som skal få gåve. Berre du ser valet.</Empty>
        ) : (
          <div className="person-grid">{chosen.map((p) => <PersonRow key={p.id} personId={p.id} />)}</div>
        )}
      </section>
      {rest.length > 0 && (
        <section>
          <div className="section-head"><h2>Andre i familien</h2></div>
          <div className="person-grid">{rest.map((p) => <PersonRow key={p.id} personId={p.id} />)}</div>
        </section>
      )}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Ny person" mobileEditor protect>
        {adding && <PersonForm onDone={() => setAdding(false)} />}
      </Sheet>
    </div>
  );
}

function RecipientSwitch({ personId }: { personId: string }) {
  const data = useData();
  const toast = useToast();
  const has = myGifts(data, personId).count > 0;
  return (
    <Switch
      checked={has || isMarked(data, personId)}
      onChange={(on) => { if (!has) void setRecipient(data, personId, on).catch((err) => toast(errorText(err))); }}

      label="Skal få gåve frå meg i år"
      hint={has ? 'Du har alt ei gåve til denne personen.' : 'Berre du ser kven du har valt.'}
    />
  );
}

/** Mitt private budsjett, som kan setjast sjølv om eg ikkje får endre personen. */
function BudgetEditor({ personId }: { personId: string }) {
  const data = useData();
  const toast = useToast();
  const saved = myMark(data, personId)?.budget ?? 0;
  const [text, setText] = useState(saved ? String(saved) : '');
  useEffect(() => setText(saved ? String(saved) : ''), [saved]);
  const commit = async () => {
    if (badAmount(text)) { toast('Budsjettet må vere eit tal, til dømes 500.'); return; }
    const value = parseAmount(text);
    if (value === saved) return;
    try {
      await setBudget(data, personId, value);
      toast('Budsjettet er lagra');
    } catch (err) { toast(errorText(err)); }
  };
  return (
    <Field label="Mitt budsjett" hint="Berre du ser dette.">
      <input
        inputMode="numeric" value={text} placeholder="kr" onChange={(e) => setText(e.target.value)} onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
    </Field>
  );
}

const giftCount = (n: number) => (n === 0 ? 'Ingen enno' : `${n} ${n === 1 ? 'gåve' : 'gåver'}`);

/** Lita oversikt: kva som er kjøpt, kva som er planlagt, og kor mykje som er att av budsjettet. */
function PersonSummary({ personId, split }: { personId: string; split: ReturnType<typeof giftsFor> }) {
  const data = useData();
  const mine = myGifts(data, personId);
  const budget = myMark(data, personId)?.budget ?? 0;
  const sum = (gifts: typeof split.bought) => gifts.reduce((s, g) => s + g.price, 0);
  const boughtSum = sum(split.bought);
  const plannedSum = sum(split.planned);
  // Rundar berre totalen og det kjøpte, så dei to delane alltid går opp i summen som står under.
  const myTotal = Math.round(mine.share);
  const myBought = Math.round(mine.boughtShare);
  const myPlanned = myTotal - myBought;
  const shared = myTotal !== Math.round(boughtSum + plannedSum);
  const over = myTotal - budget;
  const pct = (n: number) => `${Math.min(100, (n / Math.max(budget, myTotal)) * 100)}%`;
  return (
    <section className="panel person-sum" aria-label="Oversikt">
      <div className="ps-tiles">
        <div className="ps-tile st-bought">
          <span className="ps-label"><i aria-hidden="true" />Kjøpt</span>
          <strong>{kr(boughtSum)}</strong>
          <small>{giftCount(split.bought.length)}</small>
          {shared && <small>Din del {kr(myBought)}</small>}
        </div>
        <div className="ps-tile st-idea">
          <span className="ps-label"><i aria-hidden="true" />Planlagt</span>
          <strong>{kr(plannedSum)}</strong>
          <small>{giftCount(split.planned.length)}</small>
          {shared && <small>Din del {kr(myPlanned)}</small>}
        </div>
        <div className="ps-tile ps-wish">
          <span className="ps-label"><i aria-hidden="true" />Ønske</span>
          <strong>{split.open.length}</strong>
          <small>ledige</small>
        </div>
      </div>
      {budget > 0 && (
        <div className="ps-budget">
          <div className="ps-bar" aria-hidden="true">
            <i className="st-bought" style={{ width: pct(myBought) }} />
            <i className="st-idea" style={{ width: pct(myPlanned) }} />
          </div>
          <p className={over > 0 ? 'over-budget' : ''}>{shared ? 'Din del' : 'Til saman'} <strong>{kr(myTotal)}</strong> av {kr(budget)} i budsjett · {over > 0 ? `${kr(over)} over` : `${kr(-over)} igjen`}</p>
        </div>
      )}
      {budget === 0 && shared && <p className="ps-note">Din del til saman <strong>{kr(myTotal)}</strong></p>}
      {shared && <p className="ps-note">Summane øvst er heile prisen. Din del er det du betaler når felles gåver blir delte.</p>}
    </section>
  );
}

export function PersonPage() {
  const { id = '' } = useParams();
  const data = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { addGift } = useGifts();
  const [editing, setEditing] = useState(false);
  // Merkene for nye ønske skal stå medan ein ser på dei, og forsvinne når ein går vidare.
  useEffect(() => () => markSeen(id), [id]);
  const person = data.peopleById.get(id);
  if (!person) return <div className="page"><Empty title="Fann ikkje personen" action={<Link className="btn ghost" to="/folk">Til Folk</Link>} /></div>;

  const self = person.user === data.me.id;
  const split = giftsFor(data, person.id);
  const budget = myMark(data, person.id)?.budget ?? 0;
  const age = person.birth_year ? new Date().getFullYear() - person.birth_year : 0;
  const first = firstName(person.name);
  const noGifts = split.bought.length + split.planned.length === 0;
  // Visningsvalet står på den fyrste gåvelista på sida.
  const toggleOn = split.bought.length > 0 ? 'bought' : split.planned.length > 0 ? 'planned' : 'open';
  const head = (title: string, where: string, n?: number) => (
    <div className="section-head"><h2>{title}{n ? ` (${n})` : ''}</h2>{toggleOn === where && !noGifts && <ViewToggle />}</div>
  );
  // Kom ein frå Oversikt, skal tilbake-knappen gå dit, og til same stad på sida.
  const fromHome = (location.state as { from?: string } | null)?.from === 'home';

  return (
    <div className="page">
      <Link className="back" to={fromHome ? '/' : '/folk'} onClick={(e) => { if (fromHome) { e.preventDefault(); navigate(-1); } }}><ArrowLeft size={18} /> {fromHome ? 'Oversikt' : 'Folk'}</Link>
      <section className="person-hero">
        <PersonPhoto person={person} canEdit={self} />
        <div className="person-hero-text">
          <h1>{person.name}</h1>
          <p>{[person.relation, age ? `${age} år` : '', person.sizes].filter(Boolean).join(' · ')}</p>
          {person.interests && <p className="muted">{person.interests}</p>}
        </div>
        {<button className="icon-btn" onClick={() => setEditing(true)} aria-label="Endre person"><Pencil size={18} /></button>}
      </section>
      {!self && (!noGifts || split.open.length > 0 || budget > 0) && <PersonSummary personId={person.id} split={split} />}
      <div className="action-row">
        {self ? (
          <button className="btn primary" onClick={() => addGift({ kind: 'wishes' })}><Plus size={18} /> Nytt ønske</button>
        ) : (
          <>
            <button className="btn primary" onClick={() => addGift({ kind: 'plan', recipients: [person.id] })}><Plus size={18} /> Gåve til {first}</button>
            {data.config.aiEnabled && <Link className="btn ghost" to={`/nissen?person=${person.id}`}><Sparkles size={17} /> Spør Nissen</Link>}
          </>
        )}
      </div>

      {self ? (
        <>
          <WishAudience />
          <section>
            <div className="section-head"><h2>Ønska dine</h2>{split.wishes.length > 0 && <ViewToggle />}</div>
            {split.wishes.length === 0
              ? <Empty title="Du har ikkje lagt til ønske enno" />
              : <GiftView gifts={split.wishes} />}
          </section>
        </>
      ) : (
        <>
          {split.bought.length > 0 && <section>{head('Kjøpt', 'bought', split.bought.length)}<GiftView gifts={split.bought} /></section>}
          {split.planned.length > 0 && <section>{head('Planlagt', 'planned', split.planned.length)}<GiftView gifts={split.planned} /></section>}
          {noGifts && <section>{head('Gåver', '')}<p className="muted">Ingen gåver til {first} enno.</p></section>}
          <section>
            {head('Ønske', 'open', split.open.length)}
            {split.open.length > 0
              ? <GiftView gifts={split.open} />
              : <p className="muted">{split.wishes.length > 0 ? 'Alle ønska er tekne.' : `${first} har ikkje lagt inn ønske enno.`}</p>}
          </section>
          {!data.fest && (
            <section className="panel">
              <RecipientSwitch personId={person.id} />
              {isRecipient(data, person.id) && (
                <Switch checked={isDone(data, person.id)} onChange={(on) => void setDone(data, person.id, on).catch((err) => toast(errorText(err)))} label="Fullført" hint="Du er ferdig med gåvene. Personen flyttar seg nedst på oversikta." />
              )}
              {isRecipient(data, person.id) && <BudgetEditor personId={person.id} />}
            </section>
          )}
        </>
      )}

      <Sheet open={editing} onClose={() => setEditing(false)} title={`Endre ${person.name}`} mobileEditor protect>
        {editing && <PersonForm person={person} onDone={(p) => { setEditing(false); if (!p) navigate('/folk'); }} />}
      </Sheet>
    </div>
  );
}
