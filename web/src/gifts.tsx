import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { Archive, ArchiveRestore, BadgeCheck, Camera, ChevronDown, ExternalLink, Heart, LayoutGrid, Link2, List, Loader2, Pencil, ReceiptText, Search, Send, Share2, Sparkles, Trash2, Users, X } from 'lucide-react';
import { badAmount, canEditList, firstName, errorText, fileUrl, haptic, isHttpUrl, isJul, isUpcoming, kr, money, names, parseAmount, pb, PRIORITIES, shortNames, STATUSES, type Claim, type Gift, type GiftList, type Offer, type Status } from './lib';
import { audienceOf, claimerName, isNewWish, useData, useSeen } from './data';
import { Avatar, Field, GiftImage, PersonPicker, personBusy, radioKeys, Segmented, Sheet, Switch, useToast, waitForPerson, type ToastAction } from './ui';
import { ExpenseSheet, type ExpenseDraft } from './money';

export interface Draft {
  kind?: 'wishes' | 'plan';
  listId?: string;
  title?: string;
  url?: string;
  shop?: string;
  price?: number;
  note?: string;
  recipients?: string[];
}

interface GiftActions {
  addGift: (draft?: Draft) => void;
  editGift: (gift: Gift) => void;
  openGift: (id: string) => void;
  addExpense: (draft?: ExpenseDraft) => void;
}
const GiftContext = createContext<GiftActions>({ addGift: () => undefined, editGift: () => undefined, openGift: () => undefined, addExpense: () => undefined });
export const useGifts = () => useContext(GiftContext);

export function GiftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Gift | null>(null);
  const [openId, setOpenId] = useState('');
  const [expense, setExpense] = useState<ExpenseDraft | null>(null);
  return (
    <GiftContext.Provider value={{ addGift: (d) => setDraft(d ?? {}), editGift: (g) => { setOpenId(''); setEditing(g); }, openGift: setOpenId, addExpense: (d) => { setOpenId(''); setExpense(d ?? {}); } }}>
      {children}
      <GiftEditor open={!!draft || !!editing} draft={draft ?? {}} gift={editing} onClose={() => { setDraft(null); setEditing(null); }} />
      <GiftDetail id={openId} onClose={() => setOpenId('')} />
      <ExpenseSheet draft={expense} onClose={() => setExpense(null)} />
    </GiftContext.Provider>
  );
}

export function shareOf(gift: Gift, claims: Claim[]) {
  const mine = claims.filter((c) => c.gift === gift.id);
  return mine.length ? gift.price / mine.length : 0;
}

const NEXT: Record<Status, Status> = { idea: 'bought', bought: 'wrapped', wrapped: 'given', given: 'idea' };

/** Når ei felles gåve blir kjøpt, er det neste steget å registrere kven som betalte. */
function usePayAction() {
  const data = useData();
  const { addExpense } = useGifts();
  return (gift: Gift, status: Status): ToastAction | null => {
    const alreadyLogged = data.expenses.some((e) => e.gift === gift.id);
    if (status !== 'bought' || gift.givers.length < 2 || alreadyLogged) return null;
    return {
      label: 'Registrer betaling',
      onClick: () => addExpense({ giftId: gift.id, amount: gift.price, payers: data.myPerson ? [data.myPerson.id] : [], shares: gift.givers }),
    };
  };
}

type ViewMode = 'cards' | 'list';
const viewListeners = new Set<() => void>();
function readView(): ViewMode {
  try { return localStorage.getItem('gift-view') === 'list' ? 'list' : 'cards'; } catch { return 'cards'; }
}
let currentView: ViewMode = readView();
function setView(mode: ViewMode) {
  currentView = mode;
  try { localStorage.setItem('gift-view', mode); } catch { /* lagring er ikkje tilgjengeleg */ }
  viewListeners.forEach((listener) => listener());
}
function useViewMode() {
  return useSyncExternalStore((listener) => { viewListeners.add(listener); return () => viewListeners.delete(listener); }, () => currentView);
}

export function ViewToggle() {
  const mode = useViewMode();
  return (
    <div className="view-toggle" role="radiogroup" aria-label="Visning" onKeyDown={(e) => radioKeys(e, 2, mode === 'cards' ? 0 : 1, (i) => setView(i === 0 ? 'cards' : 'list'))}>
      <button type="button" role="radio" tabIndex={mode === 'cards' ? 0 : -1} aria-checked={mode === 'cards'} className={mode === 'cards' ? 'on' : ''} onClick={() => setView('cards')} aria-label="Vis som kort" title="Kort"><LayoutGrid size={17} /></button>
      <button type="button" role="radio" tabIndex={mode === 'list' ? 0 : -1} aria-checked={mode === 'list'} className={mode === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="Vis som liste" title="Liste"><List size={18} /></button>
    </div>
  );
}

/** Viser gåver som kort eller som liste, etter det brukaren har valt. group samlar lista per mottakar. */
export function GiftView({ gifts, group }: { gifts: Gift[]; group?: boolean }) {
  const mode = useViewMode();
  const data = useData();
  if (mode === 'cards') return <div className="gift-grid">{gifts.map((g) => <GiftCard key={g.id} gift={g} />)}</div>;

  const groups = new Map<string, Gift[]>();
  for (const g of gifts) {
    const key = group ? shortNames(g.recipients, data.peopleById) || 'Utan mottakar' : '';
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  const showHeads = group && groups.size > 1;
  return (
    <div className="gift-lists">
      {[...groups.entries()].map(([name, items]) => (
        <div key={name}>
          {showHeads && (
            <div className="gift-group"><span>{name}</span><small>{kr(items.reduce((s, g) => s + g.price, 0))}</small></div>
          )}
          <ul className="gift-rows">{items.map((g) => <GiftCard key={g.id} gift={g} row />)}</ul>
        </div>
      ))}
    </div>
  );
}

export function GiftCard({ gift, row }: { gift: Gift; row?: boolean }) {
  const data = useData();
  const toast = useToast();
  const payAction = usePayAction();
  const { openGift } = useGifts();
  const list = data.listsById.get(gift.list);
  const isWish = list?.kind === 'wishes';
  const ownWish = isWish && !!data.myPerson && list?.person === data.myPerson.id;
  const claims = data.claims.filter((c) => c.gift === gift.id);
  const seen = useSeen();
  const fresh = isNewWish(data, seen, gift);
  const wisher = list?.person ? data.peopleById.get(list.person)?.name.split(' ')[0] : '';
  const me = data.myPerson?.id;
  const others = (ids: string[]) => shortNames(ids.filter((id) => id !== me), data.peopleById);
  const to = !isWish ? (gift.recipients.length === 0 ? 'ikkje valt' : [gift.recipients.includes(me ?? '') ? 'deg' : '', others(gift.recipients)].filter(Boolean).join(', ')) : '';
  // Det er berre interessant kven gåva er frå, når det er andre enn deg.
  const fromOthers = others(gift.givers);
  const from = fromOthers ? (gift.givers.includes(me ?? '') ? `deg og ${fromOthers}` : fromOthers) : '';
  const status = STATUSES.find((s) => s.id === (gift.status || 'idea'));
  const editable = canEditList(list, data.me.id);
  // Medgjevarar kan følgje gåva opp, sjølv om dei ikkje kan endre lista.
  const canUpdate = editable || (!isWish && !!me && gift.givers.includes(me));
  const saving = gift.best_price > 0 && gift.price > gift.best_price ? gift.price - gift.best_price : 0;

  const cycle = async () => {
    const next = NEXT[(gift.status || 'idea') as Status];
    haptic();
    data.patch('gifts', (items) => items.map((g) => (g.id === gift.id ? { ...g, status: next } : g)));
    try {
      await pb.collection('gifts').update(gift.id, { status: next });
      const pay = payAction(gift, next);
      if (pay) toast('Kjøpt! Kven betalte?', pay);
    } catch (err) {
      toast(errorText(err));
      void data.reload('gifts');
    }
  };

  if (row) {
    const sub = isWish
      ? [ownWish ? 'Ditt ønske' : wisher && `Ønske frå ${wisher}`, gift.shop].filter(Boolean)
      : [to && `Til ${to}`, from && `Frå ${from}`, gift.shop].filter(Boolean);
    const shownPrice = gift.price > 0 ? kr(gift.price) : gift.best_price > 0 ? `frå ${kr(gift.best_price)}` : '';
    return (
      <li className={`gift-row ${!isWish && status ? `st-${status.id}` : ''}`}>
        <button type="button" className="gift-hit" onClick={() => openGift(gift.id)} aria-label={`Opne ${gift.title}`} />
        <span className="gift-thumb"><GiftImage gift={gift} /></span>
        <span className="gift-row-main">
          <span className="gift-row-title">{fresh && <b className="new-badge">Ny</b>}{isWish && gift.priority === 2 && <Heart size={12} fill="currentColor" className="row-heart" />}{gift.title}</span>
          <span className="gift-row-sub">{sub.join(' · ')}{saving > 0 && <b> · Spar {kr(saving)}</b>}</span>
        </span>
        <span className="gift-row-end">
          {shownPrice && <strong>{shownPrice}</strong>}
          {isWish && !ownWish && <span className={`pill ${claims.length ? 'pill-taken' : 'pill-free'}`}>{claims.length ? 'Teken' : 'Ledig'}</span>}
          {!isWish && status && (canUpdate
            ? <button type="button" className={`pill pill-btn pill-${status.id}`} onClick={cycle} aria-label={`Status ${status.label}. Trykk for neste`}>{status.label}</button>
            : <span className={`pill pill-${status.id}`}>{status.label}</span>)}
        </span>
      </li>
    );
  }

  return (
    <article className={`gift ${!isWish && status ? `st-${status.id}` : ''}`}>
      <button type="button" className="gift-hit" onClick={() => openGift(gift.id)} aria-label={`Opne ${gift.title}`} />
      <span className="gift-media">
        <GiftImage gift={gift} />
        {isWish && gift.priority === 2 && <span className="gift-heart" title="Mest ønskt"><Heart size={14} fill="currentColor" /></span>}
        {saving > 0 && <span className="gift-save">Spar {kr(saving)}</span>}
        {fresh && <b className="new-badge on-image">Ny</b>}
        {(isWish ? wisher : to || from) && (
          <span className="tag">
            {isWish ? (
              ownWish ? <span className="tag-line"><em>Ditt ønske</em></span> : <span className="tag-line"><em>Ønske frå</em> {wisher}</span>
            ) : (
              <>
                {to && <span className="tag-line"><em>Til</em> {to}</span>}
                {from && <span className="tag-line"><em>Frå</em> {from}</span>}
              </>
            )}
          </span>
        )}
      </span>
      <span className="gift-body">
        <span className="gift-title">{gift.title}</span>
        <span className="gift-meta">
          {gift.price > 0 ? <strong>{kr(gift.price)}</strong> : gift.best_price > 0 && <strong>frå {kr(gift.best_price)}</strong>}
          {gift.shop ? <span>{gift.shop}</span> : gift.best_shop && <span>{gift.best_shop}</span>}
        </span>
        {isWish && !ownWish && <span className={`pill ${claims.length ? 'pill-taken' : 'pill-free'}`}>{claims.length ? 'Teken' : 'Ledig'}</span>}
        {!isWish && status && (canUpdate ? (
          <button type="button" className={`pill pill-btn pill-${status.id}`} onClick={cycle} aria-label={`Status ${status.label}. Trykk for neste`}>{status.label}</button>
        ) : <span className={`pill pill-${status.id}`}>{status.label}</span>)}
      </span>
    </article>
  );
}

/** Kven andre som er med på gåva, og ein knapp som gjev dei beskjed. */
function GiverShare({ gift }: { gift: Gift }) {
  const data = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const others = gift.givers.filter((id) => id !== data.myPerson?.id && !gift.recipients.includes(id)).map((id) => data.peopleById.get(id)).filter((p) => !!p);
  if (others.length === 0) return null;
  const inApp = others.filter((p) => p.user);
  const outside = others.filter((p) => !p.user);
  const who = names(inApp.map((p) => p.id), data.peopleById);
  const share = async () => {
    setBusy(true);
    try {
      await pb.send(`/api/jul/gifts/${gift.id}/share`, { method: 'POST' });
      toast(`${who} har fått beskjed`);
    } catch (err) {
      toast(errorText(err, 'Kunne ikkje dele gåva.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="giver-share">
      {inApp.length > 0 && (
        <div className="giver-share-row">
          <Users size={17} />
          <p><strong>{who}</strong> ser gåva i appen og kan følgje ho opp.</p>
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => void share()}><Send size={14} /> Del med {inApp.length === 1 ? firstName(inApp[0].name) : 'dei'}</button>
        </div>
      )}
      {outside.length > 0 && <p className="muted">{names(outside.map((p) => p.id), data.peopleById)} er ikkje i appen, og ser ikkje gåva.</p>}
    </section>
  );
}

const priceKey = (title: string, url: string) => `${title.trim()}|${url.trim()}`;

function defaultList(lists: GiftList[], userId: string, kind: 'wishes' | 'plan', season: number, myPersonId?: string) {
  const usable = lists.filter((l) => l.kind === kind && isJul(l) && canEditList(l, userId) && (kind === 'wishes' || l.year === season));
  const mine = usable.find((l) => l.owner === userId && (kind === 'plan' || l.person === myPersonId));
  return (mine ?? usable.find((l) => l.owner === userId) ?? usable[0])?.id ?? '';
}

function GiftEditor({ open, draft, gift, onClose }: { open: boolean; draft: Draft; gift: Gift | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open} onClose={onClose} mobileEditor protect title={gift ? 'Endre gåve' : draft.listId && draft.kind === 'wishes' ? 'Nytt ønske' : 'Ny gåve'}
      footer={<button className="btn primary full" type="submit" form="gift-form" disabled={busy}>{busy ? 'Lagrar …' : gift ? 'Lagre' : 'Legg til'}</button>}
    >
      {open && <EditorForm key={gift?.id ?? 'ny'} draft={draft} gift={gift} onClose={onClose} onBusy={setBusy} />}
    </Sheet>
  );
}

function EditorForm({ draft, gift, onClose, onBusy }: { draft: Draft; gift: Gift | null; onClose: () => void; onBusy: (v: boolean) => void }) {
  const data = useData();
  const toast = useToast();
  const givenList = gift ? data.listsById.get(gift.list) : draft.listId ? data.listsById.get(draft.listId) : undefined;
  const [kind, setKind] = useState<'wishes' | 'plan'>(givenList?.kind ?? draft.kind ?? 'plan');
  const [listId, setListId] = useState(gift?.list ?? draft.listId ?? '');
  const [url, setUrl] = useState(gift?.url ?? draft.url ?? '');
  const [title, setTitle] = useState(gift?.title ?? draft.title ?? '');
  const [price, setPrice] = useState(gift?.price ? String(gift.price) : draft.price ? String(Math.round(draft.price)) : '');
  const [shop, setShop] = useState(gift?.shop ?? draft.shop ?? '');
  const [note, setNote] = useState(gift?.note ?? draft.note ?? '');
  const [priority, setPriority] = useState(gift?.priority ?? 1);
  const [status, setStatus] = useState<Status>((gift?.status as Status) || 'idea');
  const [recipients, setRecipients] = useState<string[]>(gift?.recipients ?? draft.recipients ?? []);
  const [givers, setGivers] = useState<string[]>(gift?.givers ?? (data.myPerson ? [data.myPerson.id] : []));
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState(gift ? fileUrl(gift, gift.image, '480x480') : '');
  const [removeImage, setRemoveImage] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [more, setMore] = useState(!!gift);
  const [currency, setCurrency] = useState('');
  const [saving, setSaving] = useState(false);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [offerKey, setOfferKey] = useState('');
  const [checked, setChecked] = useState('');
  const [checking, setChecking] = useState(false);
  // Funna gjeld berre produktet det blei søkt på. Blir namn eller lenke endra, gjeld dei ikkje lenger.
  const shownOffers = offers && offerKey === priceKey(title, url) ? offers : null;
  const lastFetched = useRef(gift?.url ?? '');
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const previewRun = useRef(0);
  const hasImage = useRef(!!gift?.image);
  const imageFromShop = useRef(false);
  useEffect(() => onBusy(saving), [saving, onBusy]);

  const feasts = data.fest ? data.lists.filter((l) => l.kind === kind && !isJul(l) && isUpcoming(l) && canEditList(l, data.me.id)).sort((a, b) => (a.event_date || '9').localeCompare(b.event_date || '9')) : [];
  const editable = data.lists.filter((l) => l.kind === kind && canEditList(l, data.me.id) && (l.id === draft.listId || feasts.includes(l) || (isJul(l) && (kind === 'wishes' || l.year === data.season))));
  // Utanom jula går ei ny gåve til den nærmaste feiringa.
  const effectiveList = listId && editable.some((l) => l.id === listId) ? listId : gift?.list ?? feasts[0]?.id ?? defaultList(data.lists, data.me.id, kind, data.season, data.myPerson?.id);

  const setImage = (f: File, fromShop = false) => {
    setFile(f);
    setRemoveImage(false);
    setImageUrl(URL.createObjectURL(f));
    hasImage.current = true;
    imageFromShop.current = fromShop;
  };

  const runPreview = async (target: string) => {
    lastFetched.current = target;
    const run = ++previewRun.current;
    setFetching(true);
    try {
      const p = await pb.send<{ title: string; description: string; price: number; currency: string; shop: string; image: string }>('/api/jul/preview', { method: 'POST', body: { url: target } });
      if (run !== previewRun.current) return;
      const foreign = p.currency && p.currency !== 'NOK' ? p.currency : '';
      setTitle((v) => v || p.title);
      if (!foreign) setPrice((v) => v || (p.price ? String(Math.round(p.price)) : ''));
      setShop((v) => v || p.shop);
      setNote((v) => v || p.description);
      setCurrency(foreign && p.price ? `${p.price} ${foreign}` : '');
      if (p.image && !hasImage.current) {
        const res = await fetch(pb.buildURL(`/api/jul/image?url=${encodeURIComponent(p.image)}`), { headers: { Authorization: pb.authStore.token } });
        if (res.ok && run === previewRun.current && !hasImage.current) {
          const blob = await res.blob();
          setImage(new File([blob], `produkt.${blob.type.split('/')[1] || 'jpg'}`, { type: blob.type }), true);
        }
      }
      if (!p.title) toast('Fann ikkje produktet. Skriv namnet på gåva.');
      else if (!p.price) toast('Fann namnet, men ikkje prisen.');
    } catch (err) {
      if (run === previewRun.current) toast(errorText(err, 'Kunne ikkje lese lenka.'));
    } finally {
      if (run === previewRun.current) setFetching(false);
    }
  };

  useEffect(() => {
    const target = url.trim();
    if (!isHttpUrl(target) || target === lastFetched.current) return;
    const t = window.setTimeout(() => void runPreview(target), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const checkPrice = async () => {
    setChecking(true);
    const asked = priceKey(title, url);
    try {
      const res = await pb.send<{ offers: Offer[]; note: string; checked?: string }>('/api/jul/ai/best-price', { method: 'POST', body: { title: title.trim(), url: url.trim() } });
      setOffers(res.offers);
      setOfferKey(asked);
      setChecked(res.checked ?? '');
      if (res.offers.length === 0) toast(res.note || 'Fann ingen sikre prisar.');
    } catch (err) {
      toast(errorText(err, 'Prissjekken feila.'));
    } finally {
      setChecking(false);
    }
  };
  const useOffer = (o: Offer) => {
    haptic();
    setPrice(String(Math.round(o.price)));
    setShop(o.shop);
    lastFetched.current = o.url;
    setUrl(o.url);
    setOfferKey(priceKey(title, o.url));
    setCurrency('');
  };

  const acceptUrl = (value: string) => {
    // Ei ny lenke er eit nytt produkt, så det førre sine detaljar skal ikkje henge igjen.
    if (url) {
      setPrice('');
      setShop('');
      setNote('');
      setOffers(null);
      setCurrency('');
      if (imageFromShop.current) {
        setFile(null);
        setImageUrl('');
        hasImage.current = false;
        imageFromShop.current = false;
      }
    }
    setUrl(value.trim());
    setTitle('');
  };
  // Innliming gjev lenka med ein gong. Når nokon skriv lenka for hand, ventar vi til dei er ferdige.
  const onMagic = (value: string) => {
    if (value.length - title.length > 6 && isHttpUrl(value)) acceptUrl(value);
    else setTitle(value);
  };
  const onPaste = (e: ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (pasted) { e.preventDefault(); setImage(pasted); }
  };
  const onDrop = (e: DragEvent) => {
    const dropped = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (dropped) { e.preventDefault(); setImage(dropped); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (personBusy()) {
      await waitForPerson();
      window.setTimeout(() => formRef.current?.requestSubmit(), 40);
      return;
    }
    if (isHttpUrl(title.trim())) { acceptUrl(title); return; }
    if (!title.trim()) { toast('Gåva treng eit namn.'); return; }
    if (badAmount(price)) { toast('Prisen må vere eit tal, til dømes 299 eller 1 299,50.'); return; }
    setSaving(true);
    try {
      let target = effectiveList;
      if (!target && !gift) {
        const created = await pb.collection('lists').create<GiftList>({
          name: kind === 'wishes' ? 'Ønska mine' : 'Gåveplanen min', kind,
          visibility: 'private', owner: data.me.id, year: data.season,
          person: kind === 'wishes' ? data.myPerson?.id : undefined,
        });
        await data.reload('lists');
        target = created.id;
      }
      const body: Record<string, unknown> = {
        title: title.trim().slice(0, 200), url: url.trim(), shop: shop.trim(), note: note.trim(),
        price: parseAmount(price),
        priority: kind === 'wishes' ? priority : 0,
        status: kind === 'plan' ? status : '',
        recipients: kind === 'plan' && recipients.length ? recipients : '',
        givers: kind === 'plan' && givers.length ? givers : '',
      };
      if (file) body.image = file;
      else if (removeImage) body.image = null;
      if (shownOffers) {
        const best = shownOffers.find((o) => o.currency === 'NOK');
        Object.assign(body, { offers: shownOffers, best_checked: checked, best_price: best?.price ?? 0, best_shop: best?.shop ?? '', best_url: best?.url ?? '' });
      } else if (gift && priceKey(gift.title, gift.url) !== priceKey(title.slice(0, 200), url)) {
        Object.assign(body, { offers: null, best_checked: '', best_price: 0, best_shop: '', best_url: '' });
      }
      if (gift) {
        await pb.collection('gifts').update(gift.id, body);
      } else {
        const created = await pb.collection('gifts').create<Gift>({ ...body, list: target, created_by: data.me.id });
        // Prissjekken går i bakgrunnen, og funna dukkar opp på gåva av seg sjølv.
        if (!shownOffers && data.config.autoPrice) void pb.send(`/api/jul/ai/gift-price/${created.id}`, { method: 'POST' }).catch(() => undefined);
      }
      await data.reload('gifts');
      haptic();
      const before = new Set(gift?.givers ?? []);
      const shared = kind === 'plan' ? givers.filter((id) => !before.has(id) && id !== data.myPerson?.id && data.peopleById.get(id)?.user && !recipients.includes(id)) : [];
      toast(shared.length ? `${gift ? 'Lagra' : 'Lagt til'}. Delt med ${names(shared, data.peopleById)}.` : gift ? 'Lagra' : 'Lagt til');
      onClose();
    } catch (err) {
      toast(errorText(err, 'Kunne ikkje lagre gåva.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form ref={formRef} id="gift-form" className="form" onSubmit={save} onPaste={onPaste} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} aria-busy={saving}>
      {!gift && !draft.listId && (
        <Segmented label="Type gåve" value={kind} onChange={(k) => { setKind(k); setListId(''); }} options={[{ id: 'plan', label: 'Eg vil gje' }, { id: 'wishes', label: 'Eg ønskjer meg' }]} />
      )}

      <div className="editor-top">
        <button type="button" className="image-pick" onClick={() => fileInput.current?.click()} aria-label="Vel bilete">
          {imageUrl ? <img src={imageUrl} alt="" /> : <span><Camera size={22} strokeWidth={1.5} /><small>Bilete</small></span>}
        </button>
        {imageUrl && <button type="button" className="image-remove" aria-label="Fjern bilete" onClick={() => { setFile(null); setImageUrl(''); setRemoveImage(true); hasImage.current = false; imageFromShop.current = false; }}><X size={14} /></button>}
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setImage(f); e.target.value = ''; }} />
        <div className="editor-fields">
          <Field label={url ? 'Namn' : 'Namn eller lenke'}>
            <span className="input-icon">
              {fetching ? <Loader2 size={18} className="spin" /> : <Link2 size={18} />}
              <input value={title} onChange={(e) => onMagic(e.target.value)} onBlur={() => { if (isHttpUrl(title.trim())) acceptUrl(title); }} placeholder={fetching ? 'Hentar frå butikken …' : url ? 'Namn på gåva' : 'T.d. ullsokkar'} data-initial-focus={!gift && !draft.title && !draft.url} maxLength={2000} />
            </span>
          </Field>
          <Field label="Pris" hint={currency ? `Butikken viser ${currency}. Skriv inn beløpet i kroner.` : undefined}>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="kr" />
          </Field>
        </div>
      </div>

      {url && (
        <div className="link-pill">
          <Link2 size={14} /><span>{url.replace(/^https?:\/\/(www\.)?/, '')}</span>
          <button type="button" aria-label="Fjern lenka" onClick={() => { setUrl(''); lastFetched.current = ''; }}><X size={14} /></button>
        </div>
      )}

      {data.config.aiEnabled && title.trim().length > 2 && !isHttpUrl(title) && (
        <div className="inline-price">
          <button type="button" className="price-trigger" onClick={() => void checkPrice()} disabled={checking}>
            {checking ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
            <span>{checking ? 'Samanliknar butikkar …' : shownOffers ? 'Sjekk prisen på nytt' : 'Finn beste pris no'}</span>
          </button>
          {!shownOffers && !checking && !gift && data.config.autoPrice && <small>Elles sjekkar vi automatisk når du lagrar.</small>}
          {shownOffers && shownOffers.length > 0 && (
            <ul className="offers">
              {shownOffers.slice(0, 4).map((o, i) => (
                <li key={o.url} className={i === 0 ? 'best' : ''}>
                  <div className="offer-main"><strong>{o.shop}</strong>{o.note && <small>{o.note}</small>}</div>
                  <div className="offer-price">
                    <strong>{o.currency === 'NOK' ? kr(o.price) : `${o.price} ${o.currency}`}</strong>
                    <small className={o.verified ? 'verified' : ''}>{o.verified ? <><BadgeCheck size={12} /> Lese frå butikken</> : 'Frå søk'}</small>
                  </div>
                  <div className="offer-actions">{o.currency === 'NOK' && <button type="button" className="btn small ghost" onClick={() => useOffer(o)}>Bruk</button>}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {kind === 'plan' ? (
        <>
          <PersonPicker label="Til" value={recipients} onChange={setRecipients} placeholder="Vel mottakar" />
          <PersonPicker label="Frå" value={givers} onChange={setGivers} placeholder="Vel gjevar" />
        </>
      ) : (
        <div className="field">
          <span className="field-label">Kor gjerne?</span>
          <Segmented label="Kor gjerne" value={String(priority)} onChange={(v) => setPriority(Number(v))} options={PRIORITIES.map((label, i) => ({ id: String(i), label }))} />
        </div>
      )}

      <button type="button" className={`more ${more ? 'open' : ''}`} aria-expanded={more} onClick={() => setMore(!more)}>
        <span>Fleire val</span><ChevronDown size={17} />
      </button>
      <div className={`collapse ${more ? 'open' : ''}`}>
        <div className="collapse-inner form">
          {kind === 'plan' && <div className="field"><span className="field-label">Status</span><Segmented label="Status" className={`seg-status st-${status}`} value={status} onChange={setStatus} options={STATUSES} /></div>}
          <Field label="Butikk"><input value={shop} onChange={(e) => setShop(e.target.value)} maxLength={120} /></Field>
          <Field label="Info"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} placeholder="Storleik, farge, kvar ho kan kjøpast …" /></Field>
          {!gift && editable.length > 1 && (
            <Field label="Liste">
              <select value={effectiveList} onChange={(e) => setListId(e.target.value)}>
                {editable.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          )}
        </div>
      </div>
    </form>
  );
}

function GiftDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const data = useData();
  const gift = data.allGifts.find((g) => g.id === id);
  return (
    <Sheet open={!!id && !!gift} onClose={onClose} title={gift?.title ?? ''} footer={<button type="button" className="btn ghost full" onClick={onClose}>Ferdig</button>}>
      {gift && <DetailBody key={gift.id} gift={gift} onClose={onClose} />}
    </Sheet>
  );
}

function PriceBox({ gift, editable }: { gift: Gift; editable: boolean }) {
  const data = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ key: string; offers: Offer[]; note: string } | null>(null);
  const key = priceKey(gift.title, gift.url);
  const current = fresh?.key === key ? fresh : null;
  const offers = current?.offers ?? (gift.offers?.length ? gift.offers : null);
  const note = current?.note ?? '';

  const setWatch = (on: boolean) => {
    haptic();
    data.patch('gifts', (items) => items.map((g) => (g.id === gift.id ? { ...g, watch_price: on } : g)));
    pb.collection('gifts').update(gift.id, { watch_price: on }).catch((err) => { toast(errorText(err)); void data.reload('gifts'); });
  };

  const check = async () => {
    const { id, title, url } = gift;
    setBusy(true);
    try {
      const res = await pb.send<{ offers: Offer[]; note: string; checked?: string }>('/api/jul/ai/best-price', { method: 'POST', body: { title, url } });
      setFresh({ key: priceKey(title, url), offers: res.offers, note: res.note });
      const best = res.offers.find((o) => o.currency === 'NOK');
      if (best && editable) {
        // Gåva kan ha blitt endra medan Nissen leita, og då gjeld ikkje funna henne lenger.
        const now = await pb.collection('gifts').getOne<Gift>(id);
        if (now.title !== title || now.url !== url) return;
        const found = { offers: res.offers, best_price: best.price, best_shop: best.shop, best_url: best.url, best_checked: res.checked ?? '' };
        data.patch('gifts', (items) => items.map((g) => (g.id === id ? { ...g, ...found } : g)));
        await pb.collection('gifts').update(id, found);
      }
    } catch (err) {
      toast(errorText(err, 'Prissjekken feila.'));
    } finally {
      setBusy(false);
    }
  };
  const use = async (o: Offer) => {
    haptic();
    data.patch('gifts', (items) => items.map((g) => (g.id === gift.id ? { ...g, price: o.price, shop: o.shop, url: o.url } : g)));
    try {
      await pb.collection('gifts').update(gift.id, { price: o.price, shop: o.shop, url: o.url });
      toast(`Oppdatert til ${o.shop}`);
    } catch (err) { toast(errorText(err)); void data.reload('gifts'); }
  };

  return (
    <section className="price-box">
      <div className="price-head">
        <div>
          <h3>Beste pris</h3>
          {gift.best_checked && <p className="muted">Sjekka {new Date(gift.best_checked).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}</p>}
        </div>
        {data.config.aiEnabled && (
          <button type="button" className="btn small gold" onClick={check} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Search size={15} />} {busy ? 'Leitar …' : offers ? 'Sjekk igjen' : 'Finn beste pris'}
          </button>
        )}
      </div>
      {busy && <div className="price-loading"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /><small>Nissen går gjennom butikkane. Det kan ta eit minutt.</small></div>}
      {!busy && offers && (
        <>
          {offers.length === 0 && <p className="muted">{note || 'Fann ingen sikre prisar.'}</p>}
          <ul className="offers">
            {offers.map((o, i) => (
              <li key={o.url} className={i === 0 ? 'best' : ''}>
                <div className="offer-main">
                  <strong>{o.shop}</strong>
                  {o.note && <small>{o.note}</small>}
                </div>
                <div className="offer-price">
                  <strong>{o.currency === 'NOK' ? kr(o.price) : `${o.price} ${o.currency}`}</strong>
                  <small className={o.verified ? 'verified' : ''}>{o.verified ? <><BadgeCheck size={12} /> Lese frå butikken</> : 'Frå søk'}</small>
                </div>
                <div className="offer-actions">
                  <a className="icon-btn small" href={o.url} target="_blank" rel="noreferrer noopener" aria-label={`Opne ${o.shop}`}><ExternalLink size={15} /></a>
                  {editable && o.currency === 'NOK' && <button type="button" className="btn small ghost" onClick={() => void use(o)}>Bruk</button>}
                </div>
              </li>
            ))}
          </ul>
          {offers.length > 0 && <p className="field-hint">Prisar endrar seg. Sjekk summen hos butikken før du kjøper.</p>}
        </>
      )}
      {editable && data.config.aiEnabled && (!gift.status || gift.status === 'idea') && (
        <Switch checked={gift.watch_price} onChange={setWatch} label="Følg prisen" hint="Vi sjekkar kvar veke, og du får varsel om prisen går ned." />
      )}
      <a className="price-link" href={`https://www.prisjakt.no/search?search=${encodeURIComponent(gift.title)}`} target="_blank" rel="noreferrer noopener">Søk på Prisjakt <ExternalLink size={13} /></a>
    </section>
  );
}

/** Del eitt ønske med utvalde, utan å dele heile lista. */
function WishShare({ gift }: { gift: Gift }) {
  const data = useData();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const list = data.listsById.get(gift.list);
  const shared = gift.shared_with ?? [];
  const listAudience = list ? audienceOf(data, list).people : [];
  const members = data.people.filter((p) => p.user && p.user !== data.me.id).sort((a, b) => a.name.localeCompare(b.name));
  const sharedPeople = members.filter((p) => shared.includes(p.user));
  const toggle = (user: string) => {
    const next = shared.includes(user) ? shared.filter((u) => u !== user) : [...shared, user];
    data.patch('gifts', (items) => items.map((g) => (g.id === gift.id ? { ...g, shared_with: next } : g)));
    pb.collection('gifts').update(gift.id, { shared_with: next }).catch((err) => { toast(errorText(err)); void data.reload('gifts'); });
  };
  const who = [...new Set([...listAudience, ...sharedPeople].map((p) => firstName(p.name)))];
  return (
    <section className="wish-share">
      <div className="wish-share-head">
        <span><strong>Kven ser dette ønsket?</strong><small>{who.length ? who.join(', ') : 'Berre du'}</small></span>
        <button type="button" className="btn small primary" onClick={() => setOpen(!open)} aria-expanded={open}><Share2 size={14} /> Del</button>
      </div>
      {open && (
        <div className="wish-share-pick" role="group" aria-label="Del ønsket med">
          {members.length === 0 && <p className="muted">Ingen andre har konto enno.</p>}
          {members.map((p) => {
            const viaList = listAudience.some((x) => x.id === p.id);
            const on = viaList || shared.includes(p.user);
            return (
              <button key={p.id} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} disabled={viaList} title={viaList ? 'Ser heile lista' : undefined} onClick={() => toggle(p.user)}>
                <Avatar person={p} size={22} /> {firstName(p.name)}
              </button>
            );
          })}
          <p className="field-hint">Dei du vel, ser berre dette ønsket. Vil du dele alle ønska, gjer du det på lista.</p>
        </div>
      )}
    </section>
  );
}

function DetailBody({ gift, onClose }: { gift: Gift; onClose: () => void }) {
  const data = useData();
  const toast = useToast();
  const payAction = usePayAction();
  const { editGift, addExpense } = useGifts();
  const list = data.listsById.get(gift.list);
  const isWish = list?.kind === 'wishes';
  const ownWish = isWish && !!data.myPerson && list?.person === data.myPerson.id;
  const editable = canEditList(list, data.me.id);
  const canUpdate = editable || (!isWish && !!data.myPerson && gift.givers.includes(data.myPerson.id));
  const claims = data.claims.filter((c) => c.gift === gift.id);
  const myClaim = claims.find((c) => c.user === data.me.id);
  const comments = data.comments.filter((c) => c.gift === gift.id).sort((a, b) => a.created.localeCompare(b.created));
  const expenses = data.expenses.filter((e) => e.gift === gift.id);
  const [text, setText] = useState('');
  const [rhyme, setRhyme] = useState(gift.rhyme);
  const [rhyming, setRhyming] = useState(false);

  const guard = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (err) { toast(errorText(err)); }
  };
  const setStatus = (status: Status) => {
    const previous = (gift.status || 'idea') as Status;
    if (status === previous) return;
    haptic();
    const apply = (value: Status) => data.patch('gifts', (items) => items.map((g) => (g.id === gift.id ? { ...g, status: value } : g)));
    apply(status);
    const undo: ToastAction = {
      label: 'Angre',
      onClick: () => { apply(previous); void guard(() => pb.collection('gifts').update(gift.id, { status: previous })); },
    };
    const pay = payAction(gift, status);
    toast(`Merka som ${STATUSES.find((s) => s.id === status)?.label.toLowerCase()}`, pay ? [pay, undo] : undo);
    void pb.collection('gifts').update(gift.id, { status }).catch((err) => { toast(errorText(err, 'Kunne ikkje lagre statusen.')); void data.reload('gifts'); });
    // Lat knappen gli på plass før popupen lukkar seg, så valet blir synleg.
    window.setTimeout(onClose, 320);
  };
  const reloadClaims = () => Promise.all([data.reload('claims'), data.reload('guest_claims')]);
  // join_ok er sant berre når nokon faktisk trykte «Bli med og spleis».
  const claim = () => {
    haptic();
    void guard(async () => {
      try { await pb.collection('claims').create({ gift: gift.id, user: data.me.id, status: 'reserved', join_ok: claims.length > 0 }); } finally { await reloadClaims(); }
    });
  };
  const setArchived = (archived: boolean) => {
    const apply = (value: boolean) => {
      data.patch('gifts', (items) => items.map((g) => (g.id === gift.id ? { ...g, archived: value } : g)));
      void guard(() => pb.collection('gifts').update(gift.id, { archived: value }));
    };
    apply(archived);
    onClose();
    toast(archived ? 'Flytta til arkivet' : 'Tilbake på lista', { label: 'Angre', onClick: () => apply(!archived) });
  };
  const unclaim = () => void guard(async () => { await pb.collection('claims').delete(myClaim!.id); await data.reload('claims'); });
  const toggleBought = () => { haptic(); void guard(async () => { await pb.collection('claims').update(myClaim!.id, { status: myClaim!.status === 'bought' ? 'reserved' : 'bought' }); await data.reload('claims'); }); };

  const remove = () => {
    const { id, title } = gift;
    data.hideGift(id);
    onClose();
    // Lukkar appen seg medan angrefristen går, skal slettinga likevel bli gjort.
    const onLeave = () => {
      void fetch(pb.buildURL(`/api/collections/gifts/records/${id}`), { method: 'DELETE', keepalive: true, headers: { Authorization: pb.authStore.token } });
    };
    window.addEventListener('pagehide', onLeave);
    const timer = window.setTimeout(() => {
      window.removeEventListener('pagehide', onLeave);
      pb.collection('gifts').delete(id)
        .then(() => data.reload('gifts'))
        .catch((err) => toast(errorText(err, 'Kunne ikkje slette gåva.')))
        .finally(() => data.showGift(id));
    }, 6000);
    toast(`«${title}» er sletta`, {
      label: 'Angre',
      onClick: () => { window.clearTimeout(timer); window.removeEventListener('pagehide', onLeave); data.showGift(id); },
    });
  };
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    setText('');
    pb.collection('comments').create({ gift: gift.id, user: data.me.id, text: clean })
      .then(() => data.reload('comments'))
      .catch((err) => { setText(clean); toast(errorText(err, 'Kunne ikkje sende meldinga.')); });
  };
  const makeRhyme = async () => {
    setRhyming(true);
    try {
      const to = names(gift.recipients, data.peopleById) || (list?.person ? data.peopleById.get(list.person)?.name : '') || '';
      const from = names(gift.givers, data.peopleById) || data.me.name;
      const res = await pb.send<{ text: string }>('/api/jul/ai/rhyme', { method: 'POST', body: { title: gift.title, to, from } });
      setRhyme(res.text);
      if (canUpdate) await pb.collection('gifts').update(gift.id, { rhyme: res.text });
    } catch (err) {
      toast(errorText(err, 'Nissen fann ikkje på noko rim.'));
    } finally {
      setRhyming(false);
    }
  };

  const claimNames = claims.map((c) => claimerName(data, c)).filter(Boolean);
  const to = names(gift.recipients, data.peopleById);
  const onlyMe = gift.givers.every((id) => id === data.myPerson?.id);
  const from = onlyMe ? '' : names(gift.givers, data.peopleById);
  const expenseDraft: ExpenseDraft = {
    giftId: gift.id, amount: gift.price,
    payers: data.myPerson ? [data.myPerson.id] : [],
    shares: gift.givers.length ? gift.givers : claims.filter((c) => c.user).map((c) => data.people.find((p) => p.user === c.user)?.id ?? '').filter(Boolean),
  };

  return (
    <div className="detail">
      <div className="detail-media"><GiftImage gift={gift} thumb="960x0" /></div>
      <div className="detail-facts">
        {gift.price > 0 && <strong className="detail-price">{kr(gift.price)}</strong>}
        {gift.shop && <span>{gift.shop}</span>}
        {isWish && <span>{PRIORITIES[gift.priority] ?? ''}</span>}
      </div>
      {(to || from) && (
        <div className="tag tag-inline">
          {to && <span className="tag-line"><em>Til</em> {to}</span>}
          {from && <span className="tag-line"><em>Frå</em> {from}</span>}
        </div>
      )}
      {!isWish && <GiverShare gift={gift} />}
      {isWish && list?.owner === data.me.id && <WishShare gift={gift} />}
      {gift.note && <p className="detail-note">{gift.note}</p>}
      {/^https?:\/\//i.test(gift.url) && <a className="btn ghost full" href={gift.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={17} /> Opne i butikken</a>}

      {!isWish && canUpdate && (
        <div className="field"><span className="field-label">Status</span><Segmented label="Status" className={`seg-status st-${gift.status || 'idea'}`} value={(gift.status || 'idea') as Status} onChange={setStatus} options={STATUSES} /></div>
      )}

      {isWish && !ownWish && (
        <section className="claim-box">
          <p>{claims.length ? 'Ønsket er teke.' : 'Ingen har teke denne enno.'}</p>
          {claimNames.length > 0 && (
            <details className="claim-names">
              <summary>Vis kven som har teke ønsket</summary>
              <p>{claimNames.join(' og ')}</p>
            </details>
          )}
          <div className="claim-actions">
            {myClaim ? (
              <>
                <button type="button" className={`btn ${myClaim.status === 'bought' ? 'gold' : 'ghost'}`} onClick={toggleBought}>{myClaim.status === 'bought' ? 'Kjøpt' : 'Merk som kjøpt'}</button>
                <button type="button" className="btn ghost" onClick={unclaim}>Angre</button>
              </>
            ) : (
              <button type="button" className="btn primary" onClick={claim}>{claims.length ? 'Bli med og spleis' : 'Eg tek denne'}</button>
            )}
          </div>
        </section>
      )}

      {!ownWish && <PriceBox gift={gift} editable={canUpdate} />}

      {!ownWish && (
        <section className="pay-box">
          <h3>Betaling</h3>
          {expenses.map((e) => (
            <p key={e.id} className="muted">{e.kind === 'refund' ? 'Refusjon' : 'Utlegg'} på {money(e.amount)}, betalt av {shortNames(e.payers.map((p) => p.person), data.peopleById)}, delt på {Object.values(e.allocated).filter((v) => v > 0).length}.</p>
          ))}
          <button type="button" className="btn ghost full" onClick={() => addExpense(expenseDraft)}><ReceiptText size={16} /> {expenses.length ? 'Legg til utlegg' : 'Registrer kven som betalte'}</button>
        </section>
      )}

      {!ownWish && data.config.aiEnabled && (
        <section className="rhyme">
          {rhyme && <blockquote>{rhyme}</blockquote>}
          <button type="button" className="btn ghost full" onClick={makeRhyme} disabled={rhyming}>
            {rhyming ? <Loader2 size={17} className="spin" /> : <Sparkles size={17} />} {rhyme ? 'Nytt pakkerim' : 'Skriv pakkerim'}
          </button>
        </section>
      )}

      {!ownWish && (
        <section className="thread">
          <h3>Hemmeleg prat</h3>
          {comments.map((c) => {
            const person = data.people.find((p) => p.user === c.user);
            return (
              <div className="comment" key={c.id}>
                <Avatar person={person} size={30} />
                <div><strong>{person?.name ?? 'Nokon'}</strong><p>{c.text}</p></div>
              </div>
            );
          })}
          <form className="comment-form" onSubmit={send}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Skal vi spleise?" aria-label="Skriv ein kommentar" maxLength={2000} />
            <button className="icon-btn" aria-label="Send" disabled={!text.trim()}><Send size={18} /></button>
          </form>
        </section>
      )}

      {editable && (
        <div className="form-actions spread">
          <button type="button" className="btn ghost danger" onClick={remove}><Trash2 size={16} /> Slett</button>
          {isWish && (
            <button type="button" className="btn ghost" onClick={() => setArchived(!gift.archived)}>
              {gift.archived ? <><ArchiveRestore size={16} /> Hent tilbake</> : <><Archive size={16} /> Arkiver</>}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={() => editGift(gift)}><Pencil size={16} /> Endre</button>
        </div>
      )}
    </div>
  );
}
