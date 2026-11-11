import { useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpDown, Check, ChevronDown, Gift as GiftIcon, Heart, MoreHorizontal, PartyPopper, Plus, RotateCcw, ShoppingBag, Sparkles, Wallet, X } from 'lucide-react';
import { celebrate, Count, useFlip } from '../motion';
import { coverage, inScope, isDone, isRecipient, myGifts, myMark, myPortion, newLabel, newWishCount, orderRecipients, planInScope, saveOrder, setDone, upcomingEvents, useData, useSeen } from '../data';
import { GiftCard, GiftView, shareOf, useGifts, ViewToggle } from '../gifts';
import { AdventCandles, Balloons, Bunting, Garland, PineBranch } from '../decor';
import { christmas, daysUntil, errorText, firstName, haptic, isHttpUrl, kr, money, STATUSES, type Gift, type Person, type Status } from '../lib';
import { Avatar, Empty, GiftImage, Sheet, useToast } from '../ui';
import { MeCard } from './People';
import { MobileOverview, SortList } from './HomeOrder';

const dateFormat = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long' });
const eventDate = new Intl.DateTimeFormat('nn-NO', { weekday: 'long', day: 'numeric', month: 'long' });
const STARTER_KEY = 'starter-hidden';
const mobileQuery = window.matchMedia('(max-width: 899px)');
function subscribeMobile(listener: () => void) {
  mobileQuery.addEventListener('change', listener);
  return () => mobileQuery.removeEventListener('change', listener);
}

function readStarterHidden() {
  try { return localStorage.getItem(STARTER_KEY) === '1'; } catch { return false; }
}

function useStarter(mobile: boolean) {
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
  if ((!mobile && hidden) || steps.every((s) => s.done)) return null;
  const hide = () => {
    setHidden(true);
    try { localStorage.setItem(STARTER_KEY, '1'); } catch { /* lagring er ikkje tilgjengeleg */ }
  };
  return (
    <section className="starter">
      <div className="starter-head">
        <h2>Kom i gang</h2>
        {!mobile && <button type="button" className="icon-btn" onClick={hide} aria-label="Ta vekk Kom i gang"><X size={18} /></button>}
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

function PersonRow({ person, open, onToggle }: { person: Person; open: boolean; onToggle: () => void }) {
  const data = useData();
  const toast = useToast();
  const { addGift } = useGifts();
  const [actionsOpen, setActionsOpen] = useState(false);
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
        {(data.config.aiEnabled || !data.fest) && <button type="button" className="icon-btn pr-menu" aria-label={`Fleire val for ${first}`} aria-haspopup="dialog" onClick={() => setActionsOpen(true)}><MoreHorizontal size={19} /></button>}
      </div>
      <div className={`collapse ${open ? 'open' : ''}`}>
        <div className="collapse-inner">
          {gifts.length > 0 && <ul className="pr-gifts">{gifts.map((g) => <GiftCard key={g.id} gift={g} row />)}</ul>}
          <div className="pr-actions">
            <button type="button" className="btn small primary" aria-label={`Legg til gåve til ${first}`} onClick={() => addGift({ kind: 'plan', recipients: [person.id] })}><Plus size={15} /> Legg til gåve</button>
            <Link className="btn small ghost" to={`/folk/${person.id}#onske`} state={{ from: 'home' }} aria-label={`Sjå ønska til ${first}${free > 0 ? `, ${free} ledige` : ''}`}><Heart size={14} /> Sjå ønske</Link>
          </div>
        </div>
      </div>
      <Sheet open={actionsOpen} onClose={() => setActionsOpen(false)} title={person.name}>
        <div className="pr-menu-actions">
          {data.config.aiEnabled && <Link className="btn ghost" to={`/nissen?person=${person.id}`} onClick={() => setActionsOpen(false)}><Sparkles size={18} /> Spør Nissen</Link>}
          {!data.fest && <button type="button" className="btn ghost" onClick={(e) => { setActionsOpen(false); changeDone(!done, e.currentTarget); }}>{done ? <RotateCcw size={18} /> : <Check size={18} />}{done ? 'Opne igjen' : 'Merk som fullført'}</button>}
        </div>
      </Sheet>
    </li>
  );
}

type BudgetItem = { gift: Gift; stage: Status; cost: number };

type BudgetRow = { person: Person; limit: number };
function MobileBudget({ budgets, total, items, planned, bought }: {
  budgets: BudgetRow[]; total: number; items: BudgetItem[]; planned: number; bought: number;
}) {
  const data = useData();
  const [open, setOpen] = useState(false);
  const remaining = Math.round(total - planned);
  const over = remaining < 0;
  const title = total > 0 ? 'Gåvebudsjett' : 'Gåvekostnader';
  const unpriced = items.filter((item) => item.cost <= 0).length;
  const sharedRecipients = items.some(({ gift }) => gift.recipients.length > 1);
  const recipients = new Set(budgets.map(({ person }) => person.id));
  const otherGifts = open ? items.filter(({ gift }) => {
    const list = data.listsById.get(gift.list);
    const ids = list?.kind === 'wishes' ? [list.person] : gift.recipients;
    return !ids.some((id) => recipients.has(data.linkedTarget.get(id) ?? id));
  }) : [];
  return (
    <>
      <button className="home-budget" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="budget-heading"><span>{title}</span><ChevronDown size={17} /></span>
        <span className="budget-balance">
          <strong className={over && total > 0 ? 'over-budget' : ''}>{kr(total > 0 ? Math.abs(remaining) : planned)}</strong>
          <span>{total === 0 ? (unpriced ? 'med kjend pris' : 'planlagt i alt') : over ? 'over budsjett med planen din' : 'att etter planlagde gåver'}</span>
        </span>
        <span className="budget-figures">
          {total > 0 && <span>Budsjett<b>{kr(total)}</b></span>}
          <span>Kjøpt<b>{kr(bought)}</b></span><span>Att å kjøpe<b>{kr(Math.max(0, planned - bought))}</b></span>
        </span>
        {unpriced > 0 && <span className="budget-note">{unpriced} {unpriced === 1 ? 'gåve manglar' : 'gåver manglar'} pris</span>}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {total > 0 && <p className="muted">Budsjettet er summen av budsjetta dine per person. Trykk på eit namn for å sjå gåvene eller endre beløpet.</p>}
        {sharedRecipients && <p className="budget-note">Ei gåve til fleire står hos kvar mottakar. I totalsummen tel ho éin gong.</p>}
        <ul className="budget-people">
          {open && budgets.map(({ person, limit }) => {
            const cost = myGifts(data, person.id).share;
            return <li key={person.id}><Link to={`/folk/${person.id}`} state={{ from: 'home' }}>
              <span><strong>{person.name}</strong><small>{kr(cost)} planlagt{limit > 0 && ` av ${kr(limit)}`}</small></span>
              {limit > 0 && cost > limit && <b className="over-budget">{kr(cost - limit)} over</b>}
              <ArrowRight size={16} />
            </Link></li>;
          })}
        </ul>
        {otherGifts.length > 0 && <section><h3>Andre gåver i summen</h3><ul className="budget-people">
          {otherGifts.map(({ gift, cost }) => <li key={gift.id}>{gift.title} · {cost > 0 ? kr(cost) : 'Manglar pris'}</li>)}
        </ul></section>}
      </Sheet>
    </>
  );
}

export function HomePage() {
  const data = useData();
  const { addGift } = useGifts();
  const toast = useToast();
  const mobile = useSyncExternalStore(subscribeMobile, () => mobileQuery.matches);
  const starter = useStarter(mobile);
  const buyHeading = useRef<HTMLHeadingElement>(null);
  const [quick, setQuick] = useState('');
  const [hideNisse, setHideNisse] = useState(() => { try { return localStorage.getItem('hide-nisse-bar') === '1'; } catch { return false; } });
  const closeNisse = () => {
    setHideNisse(true);
    try { localStorage.setItem('hide-nisse-bar', '1'); } catch { /* */ }
    toast('Nissen er fjerna frå oversikta. Du finn han framleis øvst.', { label: 'Angre', onClick: () => { setHideNisse(false); try { localStorage.removeItem('hide-nisse-bar'); } catch { /* */ } } });
  };
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
  const others = data.directory.filter((p) => p.user !== data.me.id && isRecipient(data, p.id));

  const allPlanGifts = data.gifts.filter((g) => planInScope(data, data.listsById.get(g.list)) && myPortion(data, g) > 0);
  // Ei idé utan mottakar er ikkje noko du skal kjøpe enno, og tel ikkje i summane.
  const noRecipient = allPlanGifts.filter((g) => g.recipients.length === 0 && (!g.status || g.status === 'idea'));
  const planGifts = allPlanGifts.filter((g) => !noRecipient.includes(g));
  const giftOf = (id: string) => data.gifts.find((g) => g.id === id);
  const items = [
    ...planGifts.map((gift): BudgetItem => ({ gift, stage: gift.status || 'idea', cost: gift.price * myPortion(data, gift) })),
    ...data.claims.flatMap((claim): BudgetItem[] => {
      if (claim.user !== data.me.id) return [];
      const gift = giftOf(claim.gift);
      if (!gift || !inScope(data, data.listsById.get(gift.list))) return [];
      return [{ gift, stage: claim.status === 'bought' ? 'bought' : 'idea', cost: claim.amount || shareOf(gift, data.claims) }];
    }),
  ];
  const planned = items.reduce((sum, item) => sum + item.cost, 0);
  const bought = items.reduce((sum, item) => sum + (item.stage === 'idea' ? 0 : item.cost), 0);
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
  const planning = rows.length > 0 || items.length > 0;
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
  if (items.length === 0 && (!mobile || empty.length === 0)) next = null;
  else if (rows.length > 0 && active.length === 0) next = { key: 'done', icon: <PartyPopper size={18} />, text: <><strong>Alle er fullført.</strong> No kan jula berre kome.</> };
  else if (pendingIn > 0) next = { key: 'pay', icon: <Wallet size={18} />, text: <><strong>{pendingIn} betaling{pendingIn > 1 ? 'ar' : ''}</strong> skal stadfestast av deg</>, action: <Link className="next-go" to="/oppgjer">Sjå <ArrowRight size={15} /></Link> };
  else if (empty.length > 0) {
    const firsts = empty.map((p) => firstName(p.name));
    const list = firsts.length > 1 ? `${firsts.slice(0, -1).join(', ')} og ${firsts[firsts.length - 1]}` : firsts[0];
    // Mange: talet øvst og namna under. Få: namnet øvst.
    const text = empty.length > 2
      ? <><strong>Gåver til {empty.length} manglar</strong><small>{list}</small></>
      : <><strong>{list} manglar gåve</strong><small>Ingenting planlagt enno</small></>;
    const person = empty[0];
    const mobileText = <><strong>{firstName(person.name)} manglar gåve</strong>{empty.length > 1 && <small>{empty.length - 1} til på lista manglar gåve</small>}</>;
    const action = mobile && data.config.aiEnabled
      ? <Link className="next-go" to={`/nissen?person=${person.id}`}>Finn gåve <ArrowRight size={15} /></Link>
      : <button type="button" className="next-go" onClick={() => addGift({ kind: 'plan', recipients: [person.id] })}>Finn gåve <ArrowRight size={15} /></button>;
    next = { key: `empty-${person.id}`, icon: <GiftIcon size={18} />, text: mobile ? mobileText : text, action };
  } else if (!mobile && toBuy.length > 0 && days <= 14) next = { key: 'buy', icon: <ShoppingBag size={18} />, text: <><strong>{toBuy.length} {toBuy.length === 1 ? 'gåve' : 'gåver'}</strong> står att å kjøpe</>, action: <button type="button" className="next-go" onClick={() => setStage('idea')}>Vis <ArrowRight size={15} /></button> };
  else if (wrapLeft > 0 && days <= 10) next = { key: 'wrap', icon: <GiftIcon size={18} />, text: <><strong>{wrapLeft} {wrapLeft === 1 ? 'gåve' : 'gåver'}</strong> ventar på papir og band</>, action: <button type="button" className="next-go" onClick={() => setStage('bought')}>Vis <ArrowRight size={15} /></button> };

  const submitQuick = (e: FormEvent) => {
    e.preventDefault();
    const value = quick.trim();
    addGift(isHttpUrl(value) ? { url: value } : { title: value });
    setQuick('');
  };
  const quickAdd = (
    <form className="quick-add big" onSubmit={submitQuick}>
      <GiftIcon size={22} className="quick-add-icon" aria-hidden="true" />
      <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={mobile ? 'Gåveidé eller lenke' : 'Lim inn ei lenke, eller skriv ei gåve'} aria-label="Legg til ei gåve" />
      <button className="icon-btn primary" aria-label="Legg til"><Plus size={22} /></button>
    </form>
  );
  const jumpToBuy = () => {
    if (!buyHeading.current) {
      setStage('idea');
      return;
    }
    setShowAll(true);
    buyHeading.current?.focus({ preventScroll: true });
    buyHeading.current?.scrollIntoView({ block: 'start' });
  };

  const hero = (
    <section className="hero hero-gifts">
      <i className="hero-glow" aria-hidden="true" />
      {data.fest ? <><Bunting /><Balloons /></> : <><div className="snow" aria-hidden="true" /><Garland /><PineBranch /><AdventCandles lit={litCandles} /></>}
      <div className="hg-text">
        {data.fest
          ? !nextEvent ? <h1>Neste feiring?</h1>
            : days > 0 ? <h1><span className="hero-num"><Count value={days} /></span> {days === 1 ? 'dag' : 'dagar'} til {nextEvent.name}</h1>
            : <h1>{nextEvent.name} er i dag!</h1>
          : days > 0 ? <h1><span className="hero-num"><Count value={days} /></span> {days === 1 ? 'dag' : 'dagar'} til julaften</h1> : <h1>God jul!</h1>}
        {mobile && toBuy.length > 0 && (
          <button type="button" className="hero-buy" onClick={jumpToBuy}>{toBuy.length} {toBuy.length === 1 ? 'gåve' : 'gåver'} att å kjøpe <ArrowRight size={16} /></button>
        )}
        {mobile && items.length > 0 && toBuy.length === 0 && <p className="hg-line">Alle planlagde gåver er kjøpte</p>}
        {!mobile && items.length > 0 && (
          <>
            <p className="hg-line"><strong><Count value={ready} /> av {items.length}</strong> gåver klare{others.length > 0 && !data.fest && <> · <strong><Count value={finished} /> av {others.length}</strong> fullført</>}</p>
            <p className="hg-money">Kjøpt for <Count value={Math.round(bought)} format={kr} /> av {kr(planned)}{moneyText && <> · <Link to="/oppgjer">{moneyText}</Link></>}</p>
          </>
        )}
      </div>
      {!mobile && items.length > 0 && (
        <div className="hg-bar" aria-hidden="true">
          {STATUSES.map((s) => <i key={s.id} className={`st-${s.id}`} style={{ flexGrow: countOf(s.id) }} />)}
        </div>
      )}
      {!mobile && items.length > 0 && (
        <div className="hg-stages" role="group" aria-label="Vis gåver etter status">
          {STATUSES.filter((s) => s.id === 'idea' || s.id === 'bought').map((s) => (
            <button key={s.id} type="button" className={`hg-stage st-${s.id} ${stage === s.id ? 'on' : ''}`} aria-pressed={stage === s.id} onClick={() => setStage(stage === s.id ? '' : s.id)}>
              <i aria-hidden="true" /><span><Count value={countOf(s.id)} /> {s.label}</span>
            </button>
          ))}
        </div>
      )}
      {!mobile && <GiftShelf items={items} />}
      {!data.fest && <svg className="hg-snow" viewBox="0 0 800 30" preserveAspectRatio="none" aria-hidden="true"><path d="M0 16 C120 2 240 26 400 14 S680 4 800 18 V30 H0 Z" /></svg>}
    </section>
  );
  const notice = showReset && <p className="note-bar">Administrator laga ei lenke for nytt passord til kontoen din {dateFormat.format(resetAt!)}. Bad du ikkje om det, så snakk med dei andre i familien.</p>;
  const nisseBanner = data.config.aiEnabled && !hideNisse && (
    <div className="nisse-bar-wrap">
      <Link className="thanks-bar nisse-bar" to="/nissen">
        <Sparkles size={18} />
        <span><strong>Treng du idear?</strong><small>Spør Nissen om gåver til dei du skal gje til.</small></span>
        <ArrowRight size={17} />
      </Link>
      <button type="button" className="icon-btn nisse-bar-close" aria-label="Fjern Nissen frå oversikta" onClick={closeNisse}><X size={17} /></button>
    </div>
  );
  const nextStep = next && (
    <p className="next" key={next.key}>
      <i className="next-icon" aria-hidden="true">{next.icon}</i>
      <span className="next-text">{next.text}</span>
      {next.action}
    </p>
  );
  const statusGifts = stage && (
    <section>
      <div className="section-head"><h2>{STATUSES.find((s) => s.id === stage)?.label} ({filtered.length})</h2>{mobile && <button className="text-btn" onClick={() => setStage('')}>Lukk</button>}<ViewToggle /></div>
      {filtered.length === 0 ? <Empty title="Ingen gåver her enno" /> : <GiftView gifts={filtered} />}
    </section>
  );
  const celebrations = data.fest && (
    <section>
      <div className="section-head"><h2>Neste feiringar</h2><Link to="/lister">Alle lister <ArrowRight size={15} /></Link></div>
      {events.length === 0
        ? <Empty title="Ingen feiringar lagt inn" action={<Link className="btn ghost" to="/lister">Til lister</Link>} />
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
  );
  const recipientList = (
    <section className="home-people">
      {!mobile && <MeCard fromHome />}
      <div className="section-head">
        <h2>Kven skal få</h2>
        <span className="section-links">
          {active.length > 1 && !sorting && !data.fest && <button type="button" className="text-btn" onClick={() => { setOpenPerson(''); setSorting(true); }}><ArrowUpDown size={14} /> Sorter</button>}
          <Link to="/folk">Vel folk <ArrowRight size={15} /></Link>
        </span>
      </div>
      {sorting ? <SortList items={active.map((person) => ({ id: person.id, name: person.name, person }))} onSave={(ids) => saveOrder(data, ids)} onClose={() => setSorting(false)} /> : rows.length === 0 ? (
        data.fest
          ? <Empty title="Ingen gåver på gang enno">Legg ei gåve i ei feiringsliste, så dukkar personen opp her.</Empty>
          : <Empty title="Du har ikkje valt nokon enno" action={<Link className="btn ghost" to="/folk">Vel kven som skal få gåve</Link>}>Berre du ser kven du har valt.</Empty>
      ) : (
        <ul className="pr-list" ref={prList}>
          {rows.map((person) => <PersonRow key={person.id} person={person} open={openPerson === person.id} onToggle={() => setOpenPerson(openPerson === person.id ? '' : person.id)} />)}
        </ul>
      )}
    </section>
  );
  const shopping = toBuy.length > 0 && (
    <section>
      <div className="section-head"><h2 ref={buyHeading} className="home-buy-heading" tabIndex={-1}>Att å kjøpe</h2><ViewToggle /></div>
      <GiftView gifts={shownToBuy} />
      {toBuy.length > 6 && <button className="text-btn show-all" onClick={() => setShowAll(!showAll)}>{showAll ? 'Vis færre' : `Vis alle ${toBuy.length}`}</button>}
    </section>
  );
  const ideas = noRecipient.length > 0 && (
    <section>
      <div className="section-head"><h2>Veit ikkje kven til enno</h2></div>
      <GiftView gifts={noRecipient} />
    </section>
  );
  const wishes = freeWishes.length > 0 && (
    <section>
      <div className="section-head"><h2>Ledige ønske</h2></div>
      <GiftView gifts={freeWishes} />
    </section>
  );

  if (mobile) {
    const budgets = rows.map((person) => ({ person, limit: myMark(data, person.id)?.budget ?? 0 }));
    const total = budgets.reduce((sum, row) => sum + row.limit, 0);
    const quickSection = { id: 'quick', name: 'Legg til gåve', content: quickAdd };
    const starterSection = { id: 'starter', name: 'Kom i gang', content: starter };
    const ownWishes = { id: 'mine', name: 'Mine ønske', content: <MeCard fromHome /> };
    const peopleSection = { id: 'people', name: 'Kven skal få', content: recipientList };
    const sections = [
      { id: 'hero', name: data.fest ? 'Neste feiring' : 'Nedteljing', content: hero },
      { id: 'budget', name: total > 0 ? 'Gåvebudsjett' : 'Gåvekostnader', content: (total > 0 || items.length > 0) && <MobileBudget budgets={budgets} total={total} items={items} bought={bought} planned={planned} /> },
      { id: 'next', name: 'Neste steg', content: nextStep },
      { id: 'events', name: 'Neste feiringar', content: celebrations },
      ...(planning ? [peopleSection, ownWishes, quickSection, starterSection] : [quickSection, starterSection, ownWishes, peopleSection]),
      { id: 'shopping', name: 'Att å kjøpe', content: shopping },
      { id: 'ideas', name: 'Gåveidear utan mottakar', content: ideas },
      { id: 'wishes', name: 'Ledige ønske', content: wishes },
    ];
    return <>
      <MobileOverview key={data.me.id} userId={data.me.id} sections={sections} notice={notice} />
      <Sheet open={!!stage} onClose={() => setStage('')} title={stage === 'idea' ? 'Att å kjøpe' : STATUSES.find((s) => s.id === stage)?.label ?? ''}>
        {filtered.length ? <GiftView gifts={filtered} /> : <Empty title="Ingen gåver her enno" />}
      </Sheet>
    </>;
  }
  return (
    <div className="page home">
      {hero}
      {notice}
      {quickAdd}
      {nisseBanner}
      {nextStep}
      {starter}
      {statusGifts}
      {celebrations}
      <div className="home-layout">
        {recipientList}
        <div className="home-gifts">{shopping}{ideas}{wishes}</div>
      </div>
    </div>
  );
}
