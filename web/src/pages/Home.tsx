import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpDown, Check, ChevronDown, Gift as GiftIcon, GripVertical, Heart, PartyPopper, Plus, RotateCcw, ShoppingBag, Sparkles, Wallet, X } from 'lucide-react';
import { calm, celebrate, Count, useFlip } from '../motion';
import { coverage, inScope, isDone, isRecipient, myGifts, myMark, myPortion, newLabel, newWishCount, orderRecipients, planInScope, saveOrder, setDone, upcomingEvents, useData, useSeen } from '../data';
import { GiftCard, GiftView, shareOf, useGifts, ViewToggle } from '../gifts';
import { AdventCandles, Balloons, Bunting, Garland, PineBranch } from '../decor';
import { christmas, daysUntil, errorText, firstName, haptic, isHttpUrl, kr, money, STATUSES, type Gift, type Person, type Status } from '../lib';
import { Avatar, Empty, GiftImage, useToast } from '../ui';
import { MeCard } from './People';

const dateFormat = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long' });
const eventDate = new Intl.DateTimeFormat('nn-NO', { weekday: 'long', day: 'numeric', month: 'long' });
const STARTER_KEY = 'starter-hidden';

function readStarterHidden() {
  try { return localStorage.getItem(STARTER_KEY) === '1'; } catch { return false; }
}

function Starter() {
  const data = useData();
  const { addGift } = useGifts();
  const [hidden, setHidden] = useState(readStarterHidden);
  const myWishes = data.gifts.some((g) => g.created_by === data.me.id && data.listsById.get(g.list)?.kind === 'wishes');
  const hasPeople = data.people.some((p) => isRecipient(data, p.id));
  const hasGift = data.gifts.some((g) => g.created_by === data.me.id && data.listsById.get(g.list)?.kind === 'plan');
  const steps = [
    { done: myWishes, label: 'Skriv kva du ønskjer deg', onClick: () => addGift({ kind: 'wishes' }) },
    { done: hasPeople, label: 'Vel kven som skal få gåve', to: '/folk' },
    { done: hasGift, label: 'Planlegg den fyrste gåva', onClick: () => addGift({ kind: 'plan' }) },
  ];
  if (hidden || steps.every((s) => s.done)) return null;
  const hide = () => {
    setHidden(true);
    try { localStorage.setItem(STARTER_KEY, '1'); } catch { /* lagring er ikkje tilgjengeleg */ }
  };
  return (
    <section className="starter">
      <div className="starter-head">
        <h2>Kom i gang</h2>
        <button type="button" className="icon-btn" onClick={hide} aria-label="Ta vekk Kom i gang"><X size={18} /></button>
      </div>
      <ol>
        {steps.map((s) => {
          const inner = <><i className={s.done ? 'done' : ''}>{s.done && <Check size={13} strokeWidth={3} />}</i><span>{s.label}</span>{!s.done && <ArrowRight size={16} />}</>;
          return <li key={s.label} className={s.done ? 'done' : ''}>{s.to ? <Link to={s.to}>{inner}</Link> : <button disabled={s.done} onClick={s.onClick}>{inner}</button>}</li>;
        })}
      </ol>
    </section>
  );
}

/** Merket på gåvene i hylla: hake for kjøpt, spørsmålstegn for det som ikkje er bestemt. */
const STAGE_MARK: Record<Status, ReactNode> = {
  idea: <b>?</b>,
  bought: <Check size={14} strokeWidth={3.4} />,
  wrapped: <GiftIcon size={13} strokeWidth={2.6} />,
  given: <Heart size={12} fill="currentColor" />,
};

/** Gåvene dine som pakkar på ei hylle i toppen av sida. */
function GiftShelf({ items }: { items: { gift: Gift; stage: Status }[] }) {
  const { openGift } = useGifts();
  const shown = [...items].sort((a, b) => Number(!!b.gift.image) - Number(!!a.gift.image)).slice(0, 6);
  if (shown.length === 0) {
    return (
      <div className="shelf" aria-hidden="true">
        {['a1', 'b2', 'd1'].map((id) => <span className="shelf-gift" key={id}><GiftImage gift={{ id, image: '' } as Gift} /></span>)}
      </div>
    );
  }
  return (
    <div className="shelf">
      {shown.map(({ gift, stage }) => (
        <button key={gift.id} type="button" className="shelf-gift" onClick={() => openGift(gift.id)} aria-label={`Opne ${gift.title}, ${STATUSES.find((s) => s.id === stage)?.label}`}>
          <GiftImage gift={gift} />
          <i className={`shelf-dot st-${stage}`} aria-hidden="true">{STAGE_MARK[stage]}</i>
        </button>
      ))}
    </div>
  );
}

/** Dra i handtaket, eller bruk piltastane. Rekkefølgja blir vist med CSS, så raden ikkje mistar fingeren undervegs. */
function SortList({ people, onClose }: { people: Person[]; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const [order, setOrder] = useState(() => people.map((p) => p.id));
  const [dragging, setDragging] = useState('');
  const [saving, setSaving] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const shownOrder = useRef(order);
  // Rada du held i: kvar i rada du tok tak, og kor langt ned i lista toppen av ho er no.
  const held = useRef({ id: '', offset: 0, top: 0 });

  const rowOf = (id: string) => list.current?.querySelector<HTMLElement>(`[data-person="${id}"]`) ?? null;
  const rowStep = () => (list.current?.firstElementChild as HTMLElement | null)?.offsetHeight || 60;
  const move = (id: string, to: number) => setOrder((current) => {
    const from = current.indexOf(id);
    if (to < 0 || to >= current.length || to === from) return current;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, id);
    return next;
  });
  const dragTo = (id: string, y: number) => {
    const box = list.current?.getBoundingClientRect();
    if (!box) return;
    const step = rowStep();
    const top = Math.max(0, Math.min((order.length - 1) * step, y - box.top - held.current.offset));
    held.current.top = top;
    const row = rowOf(id);
    if (row) row.style.translate = `0 ${top - order.indexOf(id) * step}px`;
    move(id, Math.round(top / step));
    if (y < 90) window.scrollBy(0, -12);
    else if (y > window.innerHeight - 130) window.scrollBy(0, 12);
  };
  const grab = (id: string, y: number) => {
    const row = rowOf(id);
    held.current = { id, offset: row ? y - row.getBoundingClientRect().top : 0, top: order.indexOf(id) * rowStep() };
    setDragging(id);
    haptic();
  };
  const drop = () => {
    const { id, top } = held.current;
    held.current = { id: '', offset: 0, top: 0 };
    setDragging('');
    const row = id ? rowOf(id) : null;
    if (!row) return;
    const rest = top - order.indexOf(id) * rowStep();
    row.style.translate = '';
    if (rest && !calm()) row.animate([{ translate: `0 ${rest}px` }, { translate: '0 0' }], { duration: 220, easing: 'cubic-bezier(.22, .9, .24, 1)' });
  };
  // Rada under fingeren fylgjer fingeren. Dei andre glir til side for ho.
  useLayoutEffect(() => {
    const was = shownOrder.current;
    shownOrder.current = order;
    const step = rowStep();
    const { id: heldId, top } = held.current;
    const heldRow = heldId ? rowOf(heldId) : null;
    if (heldRow) heldRow.style.translate = `0 ${top - order.indexOf(heldId) * step}px`;
    if (was === order || calm()) return;
    order.forEach((id, index) => {
      const from = was.indexOf(id);
      if (id === heldId || from === index) return;
      rowOf(id)?.animate([{ translate: `0 ${(from - index) * step}px` }, { translate: '0 0' }], { duration: 240, easing: 'cubic-bezier(.22, .9, .24, 1)' });
    });
  }, [order]);
  const save = async () => {
    setSaving(true);
    try {
      await saveOrder(data, order);
      onClose();
    } catch (err) {
      toast(errorText(err, 'Kunne ikkje lagre rekkefølgja.'));
      setSaving(false);
    }
  };

  return (
    <>
      <ul className="pr-list sort-list" ref={list}>
        {people.map((person) => (
          <li key={person.id} data-person={person.id} className={`sort-row ${dragging === person.id ? 'dragging' : ''}`} style={{ order: order.indexOf(person.id) }}>
            <Avatar person={person} size={36} />
            <strong>{person.name}</strong>
            <button
              type="button" className="grip" aria-label={`Flytt ${person.name}, plass ${order.indexOf(person.id) + 1} av ${order.length}. Bruk pil opp og ned.`}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); grab(person.id, e.clientY); }}
              onPointerMove={(e) => { if (dragging === person.id) dragTo(person.id, e.clientY); }}
              onPointerUp={drop} onPointerCancel={drop}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
                if (step) { e.preventDefault(); move(person.id, order.indexOf(person.id) + step); }
              }}
            ><GripVertical size={20} /></button>
          </li>
        ))}
      </ul>
      <div className="sort-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Avbryt</button>
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving}>{saving ? 'Lagrar …' : 'Lagre rekkefølgja'}</button>
      </div>
    </>
  );
}

function PersonRow({ person, open, onToggle }: { person: Person; open: boolean; onToggle: () => void }) {
  const data = useData();
  const toast = useToast();
  const { addGift } = useGifts();
  const done = isDone(data, person.id);
  const changeDone = (value: boolean, from?: Element) => {
    haptic();
    if (value && from) celebrate(from);
    if (open) onToggle();
    const failed = (err: unknown) => toast(errorText(err));
    setDone(data, person.id, value).catch(failed);
    toast(value ? `${firstName(person.name)} er fullført` : `${firstName(person.name)} er open igjen`, { label: 'Angre', onClick: () => { setDone(data, person.id, !value).catch(failed); } });
  };
  const mine = myGifts(data, person.id);
  const budget = myMark(data, person.id)?.budget ?? 0;
  const free = coverage(data, person.id).wishes.filter((g) => !data.claims.some((c) => c.gift === g.id)).length;
  const gifts = [...mine.planned, ...mine.claimed];
  const first = firstName(person.name);
  const seen = useSeen();
  const fresh = newWishCount(data, seen, person.id);
  const state = done
    ? <b className="pr-state ok"><Check size={13} strokeWidth={3} /> Fullført</b>
    : gifts.length === 0
    ? <b className="pr-state miss">Manglar gåve</b>
    : mine.secured > 0 ? <b className="pr-state ok">{mine.secured} sikra</b> : <b className="pr-state">{mine.ideas} {mine.ideas > 1 ? 'idear' : 'idé'}</b>;
  const amount = budget > 0 ? `${kr(mine.share)} av ${kr(budget)}` : mine.share > 0 ? kr(mine.share) : '';

  return (
    <li className={`pr ${open ? 'open' : ''} ${done ? 'done' : ''}`} data-flip={person.id}>
      <div className="pr-head">
        <Link className="pr-open" to={`/folk/${person.id}`} state={{ from: 'home' }}>
          <span className="pr-avatar">
            <Avatar person={person} size={44} />
            {done && <i className="pr-done-mark" aria-hidden="true"><Check size={13} strokeWidth={3.2} /></i>}
          </span>
          <span className="pr-text">
            <strong>{person.name}{fresh > 0 && <b className="new-badge">{newLabel(fresh)}</b>}</strong>
            <small>{state}{amount && <span className={budget > 0 && mine.share > budget ? 'over-budget' : ''}> · {amount}</span>}</small>
          </span>
        </Link>
        <button type="button" className="pr-toggle" aria-expanded={open} aria-label={`${open ? 'Skjul' : 'Vis'} gåvene til ${first}`} onClick={onToggle}>
          <span className="pr-thumbs" aria-hidden="true">
            {gifts.slice(0, 3).map((g) => <span className="pr-thumb" key={g.id}><GiftImage gift={g} /></span>)}
            {gifts.length > 3 && <span className="pr-more">+{gifts.length - 3}</span>}
          </span>
          <ChevronDown size={18} className="pr-chevron" />
        </button>
      </div>
      <div className={`collapse ${open ? 'open' : ''}`}>
        <div className="collapse-inner">
          {gifts.length > 0 && <ul className="pr-gifts">{gifts.map((g) => <GiftCard key={g.id} gift={g} row />)}</ul>}
          <div className="pr-actions">
            <button type="button" className="btn small primary" onClick={() => addGift({ kind: 'plan', recipients: [person.id] })}><Plus size={15} /> Gåve til {first}</button>
            <Link className="btn small ghost" to={`/folk/${person.id}`} state={{ from: 'home' }}><Heart size={14} /> Alt om {first}{free > 0 && ` · ${free} ønske`}</Link>
            {data.config.aiEnabled && <Link className="btn small ghost" to={`/nissen?person=${person.id}`}><Sparkles size={14} /> Idear</Link>}
            {!data.fest && (done
              ? <button type="button" className="btn small ghost pr-finish" onClick={() => changeDone(false)}><RotateCcw size={14} /> Opne igjen</button>
              : <button type="button" className="btn small gold pr-finish" onClick={(e) => changeDone(true, e.currentTarget)}><Check size={15} /> Fullført</button>)}
          </div>
        </div>
      </div>
    </li>
  );
}

export function HomePage() {
  const data = useData();
  const { addGift } = useGifts();
  const [quick, setQuick] = useState('');
  const [stage, setStage] = useState<Status | ''>('');
  const [showAll, setShowAll] = useState(false);
  const [openPerson, setOpenPerson] = useState('');
  const [sorting, setSorting] = useState(false);
  const { days: daysToJul, firstAdvent } = christmas();
  const events = data.fest ? upcomingEvents(data) : [];
  const nextEvent = events[0];
  const days = data.fest ? (nextEvent ? daysUntil(nextEvent.event_date) : 999) : daysToJul;
  const sinceAdvent = Math.floor((Date.now() - firstAdvent.getTime()) / 86400000);
  const litCandles = sinceAdvent < 0 ? 0 : Math.min(4, Math.floor(sinceAdvent / 7) + 1);
  const others = data.people.filter((p) => p.user !== data.me.id && isRecipient(data, p.id));

  const allPlanGifts = data.gifts.filter((g) => planInScope(data, data.listsById.get(g.list)) && myPortion(data, g) > 0);
  // Ei idé utan mottakar er ikkje noko du skal kjøpe enno, og tel ikkje i summane.
  const noRecipient = allPlanGifts.filter((g) => g.recipients.length === 0 && (!g.status || g.status === 'idea'));
  const planGifts = allPlanGifts.filter((g) => !noRecipient.includes(g));
  const myShare = (g: (typeof planGifts)[number]) => g.price * myPortion(data, g);
  const giftOf = (id: string) => data.gifts.find((g) => g.id === id);
  const myClaims = data.claims.filter((c) => {
    const gift = giftOf(c.gift);
    return c.user === data.me.id && (!gift || inScope(data, data.listsById.get(gift.list)));
  });
  const claimCost = (claims: typeof myClaims) => claims.reduce((sum, c) => {
    const gift = giftOf(c.gift);
    return sum + (gift ? c.amount || shareOf(gift, data.claims) : 0);
  }, 0);
  const planned = planGifts.reduce((s, g) => s + myShare(g), 0) + claimCost(myClaims);
  const bought = planGifts.filter((g) => g.status && g.status !== 'idea').reduce((s, g) => s + myShare(g), 0) + claimCost(myClaims.filter((c) => c.status === 'bought'));

  const items: { gift: Gift; stage: Status }[] = [
    ...planGifts.map((gift) => ({ gift, stage: (gift.status || 'idea') as Status })),
    ...myClaims.flatMap((c) => { const gift = giftOf(c.gift); return gift ? [{ gift, stage: (c.status === 'bought' ? 'bought' : 'idea') as Status }] : []; }),
  ];
  const countOf = (s: Status) => items.filter((i) => i.stage === s).length;
  const ready = items.length - countOf('idea');
  const toBuy = items.filter((i) => i.stage === 'idea').map((i) => i.gift);
  const shownToBuy = showAll ? toBuy : toBuy.slice(0, 6);
  const filtered = stage ? items.filter((i) => i.stage === stage).map((i) => i.gift) : [];

  const freeWishes = data.gifts.filter((g) => {
    const l = data.listsById.get(g.list);
    return l?.kind === 'wishes' && inScope(data, l) && l.person !== data.myPerson?.id && !data.claims.some((c) => c.gift === g.id);
  }).sort((a, b) => b.priority - a.priority || b.created.localeCompare(a.created)).slice(0, 6);

  const rows = orderRecipients(data, others);
  const active = rows.filter((p) => !isDone(data, p.id));
  const finished = rows.length - active.length;
  const net = data.ledger ? data.ledger.owed - data.ledger.owe : 0;
  const pendingIn = data.settlements.filter((s) => s.status === 'pending' && s.receivers.includes(data.me.id)).length;
  const resetAt = data.me.password_reset_at ? new Date(data.me.password_reset_at) : null;
  const showReset = !!resetAt && Date.now() - resetAt.getTime() < 30 * 86400000;
  const moneyText = pendingIn > 0 ? `${pendingIn} betaling${pendingIn > 1 ? 'ar' : ''} ventar på svar` : net > 0 ? `${money(net)} til gode` : net < 0 ? `${money(-net)} å betale` : '';

  const prList = useRef<HTMLUListElement>(null);
  useFlip(prList, rows.map((p) => p.id).join());

  // Éi line som seier kva som er lurast å gjere no. Ho er borte når ingenting hastar.
  const empty = active.filter((p) => { const mine = myGifts(data, p.id); return mine.planned.length + mine.claimed.length === 0; });
  const wrapLeft = countOf('bought');
  let next: { key: string; icon: ReactNode; text: ReactNode; action?: ReactNode } | null = null;
  if (items.length === 0) next = null;
  else if (rows.length > 0 && active.length === 0) next = { key: 'done', icon: <PartyPopper size={18} />, text: <><strong>Alle er fullført.</strong> No kan jula berre kome.</> };
  else if (pendingIn > 0) next = { key: 'pay', icon: <Wallet size={18} />, text: <><strong>{pendingIn} betaling{pendingIn > 1 ? 'ar' : ''}</strong> skal stadfestast av deg</>, action: <Link className="next-go" to="/oppgjer">Sjå <ArrowRight size={15} /></Link> };
  else if (empty.length > 0) next = { key: `empty-${empty[0].id}`, icon: <GiftIcon size={18} />, text: <><strong>Ingenting til {firstName(empty[0].name)}</strong>{empty.length > 1 ? ` og ${empty.length - 1} til` : ''} enno</>, action: <button type="button" className="next-go" onClick={() => addGift({ kind: 'plan', recipients: [empty[0].id] })}>Finn gåve <ArrowRight size={15} /></button> };
  else if (toBuy.length > 0 && days <= 14) next = { key: 'buy', icon: <ShoppingBag size={18} />, text: <><strong>{toBuy.length} {toBuy.length === 1 ? 'gåve' : 'gåver'}</strong> står att å kjøpe</>, action: <button type="button" className="next-go" onClick={() => setStage('idea')}>Vis <ArrowRight size={15} /></button> };
  else if (wrapLeft > 0 && days <= 10) next = { key: 'wrap', icon: <GiftIcon size={18} />, text: <><strong>{wrapLeft} {wrapLeft === 1 ? 'gåve' : 'gåver'}</strong> ventar på papir og band</>, action: <button type="button" className="next-go" onClick={() => setStage('bought')}>Vis <ArrowRight size={15} /></button> };

  const submitQuick = (e: FormEvent) => {
    e.preventDefault();
    const value = quick.trim();
    addGift(isHttpUrl(value) ? { url: value } : { title: value });
    setQuick('');
  };

  return (
    <div className="page home">
      <section className="hero hero-gifts">
        <i className="hero-glow" aria-hidden="true" />
        {data.fest ? <><Bunting /><Balloons /></> : <><div className="snow" aria-hidden="true" /><Garland /><PineBranch /><AdventCandles lit={litCandles} /></>}
        <div className="hg-text">
          <p className="eyebrow">Hei, {firstName(data.me.name)}</p>
          {data.fest
            ? !nextEvent ? <h1>Neste feiring?</h1>
              : days > 0 ? <h1><span className="hero-num"><Count value={days} /></span> {days === 1 ? 'dag' : 'dagar'} til {nextEvent.name}</h1>
              : <h1>{nextEvent.name} er i dag!</h1>
            : days > 0 ? <h1><span className="hero-num"><Count value={days} /></span> {days === 1 ? 'dag' : 'dagar'} til julaften</h1> : <h1>God jul!</h1>}
          {items.length > 0 ? (
            <>
              <p className="hg-line"><strong><Count value={ready} /> av {items.length}</strong> gåver klare{others.length > 0 && !data.fest && <> · <strong><Count value={finished} /> av {others.length}</strong> fullført</>}</p>
              <p className="hg-money">Kjøpt for <Count value={Math.round(bought)} format={kr} /> av {kr(planned)}{moneyText && <> · <Link to="/oppgjer">{moneyText}</Link></>}</p>
            </>
          ) : <p className="hg-line">{data.fest && !nextEvent ? 'Lag ei liste til bursdagen eller feiringa, så held appen styr på gåvene.' : 'Gåvene dine dukkar opp her.'}</p>}
        </div>
        {items.length > 0 && (
          <div className="hg-bar" aria-hidden="true">
            {STATUSES.map((s) => <i key={s.id} className={`st-${s.id}`} style={{ flexGrow: countOf(s.id) }} />)}
          </div>
        )}
        {items.length > 0 && (
          <div className="hg-stages" role="group" aria-label="Vis gåver etter status">
            {STATUSES.map((s) => (
              <button key={s.id} type="button" className={`hg-stage st-${s.id} ${stage === s.id ? 'on' : ''}`} aria-pressed={stage === s.id} onClick={() => setStage(stage === s.id ? '' : s.id)}>
                <i aria-hidden="true" /><span><Count value={countOf(s.id)} /> {s.label}</span>
              </button>
            ))}
          </div>
        )}
        <GiftShelf items={items} />
        {!data.fest && <svg className="hg-snow" viewBox="0 0 800 30" preserveAspectRatio="none" aria-hidden="true"><path d="M0 16 C120 2 240 26 400 14 S680 4 800 18 V30 H0 Z" /></svg>}
      </section>

      {showReset && <p className="note-bar">Administrator laga ei lenke for nytt passord til kontoen din {dateFormat.format(resetAt!)}. Bad du ikkje om det, så snakk med dei andre i familien.</p>}

      {data.config.thanksOpen && (
        <Link className="thanks-bar" to="/takk">
          <Heart size={18} />
          <span><strong>Kven gav deg kva?</strong><small>Takkelista di er open.</small></span>
          <ArrowRight size={17} />
        </Link>
      )}

      <form className="quick-add" onSubmit={submitQuick}>
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Lim inn ei lenke, eller skriv ei gåve" aria-label="Legg til ei gåve" />
        <button className="icon-btn primary" aria-label="Legg til"><Plus size={20} /></button>
      </form>

      {next && (
        <p className="next" key={next.key}>
          <i className="next-icon" aria-hidden="true">{next.icon}</i>
          <span className="next-text">{next.text}</span>
          {next.action}
        </p>
      )}

      <Starter />

      {stage && (
        <section>
          <div className="section-head"><h2>{STATUSES.find((s) => s.id === stage)?.label} ({filtered.length})</h2><ViewToggle /></div>
          {filtered.length === 0 ? <Empty title="Ingen gåver her enno" /> : <GiftView gifts={filtered} />}
        </section>
      )}

      {data.fest && (
        <section>
          <div className="section-head"><h2>Neste feiringar</h2><Link to="/lister">Alle lister <ArrowRight size={15} /></Link></div>
          {events.length === 0
            ? <Empty title="Ingen feiringar lagt inn" action={<Link className="btn ghost" to="/lister">Lag ei liste</Link>}>Bursdag, konfirmasjon eller bryllaup: alt får plass.</Empty>
            : (
              <ul className="fest-list">
                {events.slice(0, 6).map((list) => {
                  const left = daysUntil(list.event_date);
                  return (
                    <li key={list.id}>
                      <Link to={`/lister/${list.id}`}>
                        <b className="fest-days"><span>{left}</span><small>{left === 1 ? 'dag' : 'dagar'}</small></b>
                        <span className="fest-text"><strong>{list.name}</strong><small>{eventDate.format(new Date(list.event_date.slice(0, 10)))}</small></span>
                        <ArrowRight size={17} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
        </section>
      )}

      <div className="home-layout">
        <section className="home-people">
          <MeCard fromHome />
          <div className="section-head">
            <h2>Kven skal få</h2>
            <span className="section-links">
              {active.length > 1 && !sorting && !data.fest && <button type="button" className="text-btn" onClick={() => { setOpenPerson(''); setSorting(true); }}><ArrowUpDown size={14} /> Sorter</button>}
              <Link to="/folk">Vel folk <ArrowRight size={15} /></Link>
            </span>
          </div>
          {sorting ? <SortList people={active} onClose={() => setSorting(false)} /> : rows.length === 0 ? (
            data.fest
              ? <Empty title="Ingen gåver på gang enno">Legg ei gåve i ei feiringsliste, så dukkar personen opp her.</Empty>
              : <Empty title="Du har ikkje valt nokon enno" action={<Link className="btn ghost" to="/folk">Vel kven som skal få gåve</Link>}>Lista er berre di, og du treng ikkje ha bestemt gåvene.</Empty>
          ) : (
            <ul className="pr-list" ref={prList}>
              {rows.map((person) => <PersonRow key={person.id} person={person} open={openPerson === person.id} onToggle={() => setOpenPerson(openPerson === person.id ? '' : person.id)} />)}
            </ul>
          )}
        </section>

        <div className="home-gifts">
          {toBuy.length > 0 && (
            <section>
              <div className="section-head"><h2>Att å kjøpe</h2><ViewToggle /></div>
              <GiftView gifts={shownToBuy} />
              {toBuy.length > 6 && <button className="text-btn show-all" onClick={() => setShowAll(!showAll)}>{showAll ? 'Vis færre' : `Vis alle ${toBuy.length}`}</button>}
            </section>
          )}
          {noRecipient.length > 0 && (
            <section>
              <div className="section-head"><h2>Veit ikkje kven til enno</h2></div>
              <GiftView gifts={noRecipient} />
            </section>
          )}
          {freeWishes.length > 0 && (
            <section>
              <div className="section-head"><h2>Ledige ønske</h2></div>
              <GiftView gifts={freeWishes} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
