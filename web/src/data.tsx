import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { RecordModel } from 'pocketbase';
import { daysUntil, firstName, fileTokenStale, isFest, isJul, isUpcoming, pb, refreshFileToken, seasonYear, type Claim, type Comment, type Expense, type Gift, type GiftList, type GuestClaim, type Ledger, type Person, type PersonNote, type PrivatePhoto, type NoteFields, NOTE_FIELDS, type RecipientMark, type Settlement, type User } from './lib';

interface Store {
  people: Person[];
  lists: GiftList[];
  gifts: Gift[];
  claims: Claim[];
  guest_claims: GuestClaim[];
  comments: Comment[];
  users: User[];
  expenses: Expense[];
  settlements: Settlement[];
  recipients: RecipientMark[];
  photos: PrivatePhoto[];
  person_notes: PersonNote[];
}
const EMPTY: Store = { people: [], lists: [], gifts: [], claims: [], guest_claims: [], comments: [], users: [], expenses: [], settlements: [], recipients: [], photos: [], person_notes: [] };
const COLLECTIONS = ['people', 'lists', 'gifts', 'claims', 'guest_claims', 'comments', 'users', 'expenses', 'settlements', 'recipients', 'photos', 'person_notes'] as const;
type Key = (typeof COLLECTIONS)[number];

export function useAuth() {
  const [auth, setAuth] = useState<RecordModel | null>(pb.authStore.record);
  useEffect(() => pb.authStore.onChange((_, record) => setAuth(record)), []);
  return auth;
}

export interface AppConfig {
  familyName: string;
  aiEnabled: boolean;
  simplify: boolean;
  autoPrice: boolean;
  thanksOpen?: boolean;
  season?: number;
}

export interface DataValue extends Store {
  allGifts: Gift[];
  ready: boolean;
  loadFailed: boolean;
  retry: () => void;
  me: User;
  myPerson?: Person;
  peopleById: Map<string, Person>;
  listsById: Map<string, GiftList>;
  usersById: Map<string, User>;
  reload: (key: Key) => Promise<void>;
  patch: <K extends Key>(key: K, fn: (items: Store[K]) => Store[K]) => void;
  hideGift: (id: string) => void;
  showGift: (id: string) => void;
  season: number;
  /** Sant utanom jula: då handlar appen om bursdagar og andre feiringar. */
  fest: boolean;
  ledger: Ledger | null;
  ledgerFailed: boolean;
  reloadLedger: () => void;
  config: AppConfig;
  reloadConfig: () => void;
}

const DataContext = createContext<DataValue | null>(null);

export function DataProvider({ children, me }: { children: ReactNode; me: RecordModel }) {
  const [store, setStore] = useState<Store>(EMPTY);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerFailed, setLedgerFailed] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [config, setConfig] = useState<AppConfig>({ familyName: '', aiEnabled: false, simplify: true, autoPrice: false });
  const [fileTick, setFileTick] = useState(0);
  const [fest, setFest] = useState(() => isFest());
  useEffect(() => {
    const onChange = () => setFest(isFest());
    window.addEventListener('season-change', onChange);
    return () => window.removeEventListener('season-change', onChange);
  }, []);
  const timers = useRef<Partial<Record<Key, number>>>({});

  const reload = useCallback(async (key: Key) => {
    const items = await pb.collection(key).getFullList({ batch: 500 });
    setStore((s) => ({ ...s, [key]: items }));
  }, []);

  const patch = useCallback(<K extends Key>(key: K, fn: (items: Store[K]) => Store[K]) => {
    setStore((s) => ({ ...s, [key]: fn(s[key]) }));
  }, []);

  const reloadConfig = useCallback(() => {
    pb.send<AppConfig>('/api/jul/config', {}).then(setConfig).catch(() => undefined);
  }, []);

  const hideGift = useCallback((id: string) => setHidden((s) => new Set(s).add(id)), []);
  const showGift = useCallback((id: string) => setHidden((s) => { const next = new Set(s); next.delete(id); return next; }), []);

  const load = useCallback(() => {
    setLoadFailed(false);
    // Nøkkelen må vere klar før fyrste gåve blir teikna, elles manglar bileta.
    Promise.all([refreshFileToken(), ...COLLECTIONS.map(reload)]).then(() => setReady(true)).catch(() => setLoadFailed(true));
  }, [reload]);
  const retry = useCallback(() => { reloadConfig(); load(); }, [reloadConfig, load]);

  useEffect(() => {
    pb.collection('users').authRefresh().catch((err) => {
      if (err?.status === 401) pb.authStore.clear();
    });
    reloadConfig();
    load();

    const unsubs = COLLECTIONS.map((key) =>
      pb.collection(key).subscribe('*', () => {
        window.clearTimeout(timers.current[key]);
        timers.current[key] = window.setTimeout(() => void reload(key).catch(() => undefined), 150);
      }),
    );
    const renewFileToken = () => {
      if (fileTokenStale()) void refreshFileToken().then(() => setFileTick((n) => n + 1)).catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      renewFileToken();
      COLLECTIONS.forEach((k) => void reload(k).catch(() => undefined));
    };
    document.addEventListener('visibilitychange', onVisible);
    const tokenTimer = window.setInterval(renewFileToken, 30 * 60 * 1000);
    return () => {
      window.clearInterval(tokenTimer);
      document.removeEventListener('visibilitychange', onVisible);
      unsubs.forEach((p) => void p.then((off) => off()).catch(() => undefined));
    };
  }, [reload, reloadConfig, load]);

  const reloadLedger = useCallback(() => {
    setLedgerFailed(false);
    pb.send<Ledger>('/api/jul/settle', {}).then(setLedger).catch(() => setLedgerFailed(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(reloadLedger, 120);
    return () => window.clearTimeout(t);
  }, [ready, store.expenses, store.settlements, store.people, reloadLedger]);

  const value = useMemo<DataValue>(() => {
    const season = config.season || seasonYear();
    // Det eg har skrive om ein person, går føre det personen har skrive om seg sjølv. Berre eg ser det.
    const notes = new Map(store.person_notes.map((n) => [n.person, n]));
    const people = store.people.map((p) => {
      const note = p.user === me.id ? undefined : notes.get(p.id);
      if (!note) return p;
      const extra: Partial<Person> = {};
      for (const f of NOTE_FIELDS) if (note[f]) (extra as Record<string, unknown>)[f] = note[f];
      return { ...p, ...extra };
    });
    const peopleById = new Map(people.map((p) => [p.id, p]));
    const listsById = new Map(store.lists.map((l) => [l.id, l]));
    const usersById = new Map(store.users.map((u) => [u.id, u]));
    const listOfGift = new Map(store.gifts.map((g) => [g.id, listsById.get(g.list)]));
    const allGifts = hidden.size ? store.gifts.filter((g) => !hidden.has(g.id)) : store.gifts;
    const guests = store.guest_claims.map((g) => ({ ...g, user: '', status: 'reserved', amount: 0, guest_name: g.name }) as Claim);
    return {
      ...store,
      people,
      // Ein reservasjon til jul gjeld éi jul. Andre høve skjer berre éin gong.
      claims: [...store.claims, ...guests].filter((c) => c.year === season || !isJul(listOfGift.get(c.gift))),
      allGifts,
      gifts: allGifts.filter((g) => !g.archived),
      ready, loadFailed, retry, patch, reload, hideGift, showGift, ledger, ledgerFailed, reloadLedger, config, reloadConfig,
      me: (usersById.get(me.id) ?? me) as User,
      myPerson: people.find((p) => p.user === me.id),
      peopleById, listsById, usersById, season, fest,
    };
    // fileTick gjer at bileta får den nye nøkkelen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, hidden, ready, loadFailed, retry, me, reload, patch, hideGift, showGift, ledger, ledgerFailed, reloadLedger, config, reloadConfig, fileTick, fest]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/** Som useData, men gjev undefined utanfor innlogga delar av appen. */
export const useMaybeData = () => useContext(DataContext) ?? undefined;

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData utanfor DataProvider');
  return ctx;
}

/** Min del av ei gåve, frå 0 til 1. Hushald og born som går via meg, tel som meg. */
export function myPortion(data: DataValue, gift: Gift) {
  if (gift.givers.length === 0) return gift.created_by === data.me.id ? 1 : 0;
  const mine = data.myPerson?.id;
  if (!mine) return 0;
  const wallets = data.ledger?.wallets ?? {};
  const myWallet = wallets[mine] ?? mine;
  return gift.givers.filter((p) => (wallets[p] ?? p) === myWallet).length / gift.givers.length;
}

/** Høyrer lista til det som er aktuelt no? Jula i jula, og komande feiringar resten av året. */
export const inScope = (data: DataValue, list?: GiftList) => !!list && (data.fest ? !isJul(list) && isUpcoming(list) : isJul(list));
export const planInScope = (data: DataValue, list?: GiftList) => list?.kind === 'plan' && inScope(data, list) && (data.fest || list.year === data.season);

/** Komande feiringar med dato, nærmaste fyrst. */
export function upcomingEvents(data: DataValue) {
  const events = data.lists.filter((l) => !isJul(l) && l.event_date && daysUntil(l.event_date) >= 0);
  return events.sort((a, b) => a.event_date.localeCompare(b.event_date));
}

/** Det eg sjølv har planlagt eller teke til ein person no. */
export function myGifts(data: DataValue, personId: string) {
  const planned = data.gifts.filter((g) => planInScope(data, data.listsById.get(g.list)) && g.recipients.includes(personId) && myPortion(data, g) > 0);
  const claimed = data.gifts.filter((g) => {
    const list = data.listsById.get(g.list);
    return list?.kind === 'wishes' && inScope(data, list) && list.person === personId && data.claims.some((c) => c.gift === g.id && c.user === data.me.id);
  });
  const bought = planned.filter(isBoughtPlan);
  const myClaim = (g: Gift) => data.claims.find((c) => c.gift === g.id && c.user === data.me.id);
  const planCost = (s: number, g: Gift) => s + g.price * myPortion(data, g);
  const claimCost = (s: number, g: Gift) => s + (myClaim(g)?.amount || g.price / Math.max(1, data.claims.filter((c) => c.gift === g.id).length));
  // share er alt eg har sett av til personen, boughtShare er det av det som faktisk er kjøpt.
  const share = planned.reduce(planCost, 0) + claimed.reduce(claimCost, 0);
  const boughtShare = bought.reduce(planCost, 0) + claimed.filter((g) => myClaim(g)?.status === 'bought').reduce(claimCost, 0);
  return { planned, claimed, count: planned.length + claimed.length, secured: bought.length + claimed.length, ideas: planned.length - bought.length, share, boughtShare };
}

const isBoughtPlan = (g: Gift) => !!g.status && g.status !== 'idea';

/** Gåvene til ein person, delte etter kvar dei står: kjøpt, planlagt, eller ønske ingen har teke. */
export function giftsFor(data: DataValue, personId: string) {
  const { planned, wishes } = coverage(data, personId);
  const claimsOf = (g: Gift) => data.claims.filter((c) => c.gift === g.id);
  const boughtWish = (g: Gift) => claimsOf(g).some((c) => c.status === 'bought');
  return {
    bought: [...planned.filter(isBoughtPlan), ...wishes.filter(boughtWish)],
    planned: [...planned.filter((g) => !isBoughtPlan(g)), ...wishes.filter((g) => claimsOf(g).length > 0 && !boughtWish(g))],
    open: wishes.filter((g) => claimsOf(g).length === 0),
    wishes,
  };
}

/** Kven som kan sjå ei ønskeliste, sagt slik at eigaren forstår det. */
export function audienceOf(data: DataValue, list: GiftList) {
  const others = data.people.filter((p) => p.user && p.user !== data.me.id);
  const link = list.share_token ? ' Alle med delingslenka kan òg sjå dei.' : '';
  if (list.visibility === 'private') return { people: [] as Person[], label: 'Berre du', short: 'Berre du ser dei', hint: `Ingen andre i familien kan sjå dei.${link}` };
  if (list.visibility === 'family') return { people: others, label: 'Heile familien', short: 'Heile familien ser dei', hint: `Alle med konto kan sjå dei.${link}` };
  const people = others.filter((p) => list.editors.includes(p.user) || list.viewers.includes(p.user));
  return { people, label: people.map((p) => firstName(p.name)).join(', ') || 'Ingen utvalde', short: `${people.length} utvalde ser dei`, hint: `Berre dei du har valt.${link}` };
}

/** Ønskelistene mine for i år. */
export function myWishLists(data: DataValue) {
  const mine = data.lists.filter((l) => l.kind === 'wishes' && isJul(l) && l.owner === data.me.id && l.person === data.myPerson?.id);
  const current = mine.filter((l) => l.year === data.season);
  return current.length > 0 ? current : mine;
}

/** Merka (skal få gåve, budsjett, fullført) gjeld jula. */
export function myMark(data: DataValue, personId: string) {
  if (data.fest) return undefined;
  return data.recipients.find((r) => r.person === personId && r.year === data.season);
}

export function isMarked(data: DataValue, personId: string) {
  return !!myMark(data, personId);
}

/** Skal få gåve: valt på lista mi, eller så har eg alt planlagt noko til personen. */
export function isRecipient(data: DataValue, personId: string) {
  return isMarked(data, personId) || myGifts(data, personId).count > 0;
}

export async function setRecipient(data: DataValue, personId: string, on: boolean) {
  const existing = myMark(data, personId);
  if (existing?.id.startsWith('ny-')) return;
  try {
    if (on && !existing) {
      data.patch('recipients', (items) => [...items, { id: `ny-${personId}`, user: data.me.id, person: personId, year: data.season, budget: 0 } as RecipientMark]);
      await pb.collection('recipients').create({ user: data.me.id, person: personId, year: data.season });
    } else if (!on && existing) {
      data.patch('recipients', (items) => items.filter((r) => r.id !== existing.id));
      await pb.collection('recipients').delete(existing.id);
    }
  } finally {
    await data.reload('recipients');
  }
}

/** Budsjett, fullført og rekkefølge er private og ligg på mi eiga liste. Personen kan vere på lista berre fordi eg har ei gåve. */
async function saveMark(data: DataValue, personId: string, change: Partial<Pick<RecipientMark, 'budget' | 'done' | 'sort'>>) {
  const filter = pb.filter('user = {:u} && person = {:p} && year = {:y}', { u: data.me.id, p: personId, y: data.season });
  const found = await pb.collection('recipients').getList<RecipientMark>(1, 1, { filter });
  if (found.items[0]) await pb.collection('recipients').update(found.items[0].id, change);
  else await pb.collection('recipients').create({ user: data.me.id, person: personId, year: data.season, ...change });
}

export async function setBudget(data: DataValue, personId: string, budget: number) {
  await saveMark(data, personId, { budget });
  await data.reload('recipients');
}

export const isDone = (data: DataValue, personId: string) => !!myMark(data, personId)?.done;

export async function setDone(data: DataValue, personId: string, done: boolean) {
  data.patch('recipients', (items) => items.map((r) => (r.person === personId && r.year === data.season ? { ...r, done } : r)));
  try {
    await saveMark(data, personId, { done });
  } finally {
    await data.reload('recipients');
  }
}

/** Lagrar rekkefølgja eg har valt. Berre dei som faktisk flytta seg, blir skrivne. */
export async function saveOrder(data: DataValue, ids: string[]) {
  for (const [index, id] of ids.entries()) {
    if ((myMark(data, id)?.sort ?? 0) !== index + 1) await saveMark(data, id, { sort: index + 1 });
  }
  await data.reload('recipients');
}

/** Fullførte nedst. Elles eiga rekkefølge, og til slutt dei som manglar gåve fyrst. */
export function orderRecipients(data: DataValue, people: Person[]) {
  const rank = (p: Person) => myMark(data, p.id)?.sort || Number.MAX_SAFE_INTEGER;
  const hasGift = (p: Person) => Number(myGifts(data, p.id).count > 0);
  return [...people].sort((a, b) => Number(isDone(data, a.id)) - Number(isDone(data, b.id)) || rank(a) - rank(b) || hasGift(a) - hasGift(b) || a.name.localeCompare(b.name));
}

export function coverage(data: DataValue, personId: string) {
  const planned = data.gifts.filter((g) => planInScope(data, data.listsById.get(g.list)) && g.recipients.includes(personId));
  // Ønskelista frå jula er like nyttig til bursdagen.
  const wishes = data.gifts.filter((g) => {
    const list = data.listsById.get(g.list);
    return list?.kind === 'wishes' && list.person === personId && (isJul(list) || inScope(data, list));
  });
  return { planned, wishes };
}

/** Namnet på den som har teke eit ønske, om det er ein med konto eller ein gjest. */
export function claimerName(data: DataValue, claim: Claim) {
  return claim.guest_name ?? firstName(data.usersById.get(claim.user)?.name);
}

/* Nytt sidan sist: kvar eining hugsar når du sist såg på kvar person. */
const SEEN_KEY = 'seen-wishes';
interface Seen { base: number; people: Record<string, number> }

function readSeen(): Seen {
  try {
    const saved = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as Seen | null;
    if (saved?.base) return saved;
  } catch { /* lagring er ikkje tilgjengeleg */ }
  // Fyrste gong er ingenting «nytt», elles ville alle ønska lyse opp.
  const fresh = { base: Date.now(), people: {} };
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(fresh)); } catch { /* lagring er ikkje tilgjengeleg */ }
  return fresh;
}

let seen = readSeen();
const seenListeners = new Set<() => void>();

export function markSeen(personId: string) {
  seen = { ...seen, people: { ...seen.people, [personId]: Date.now() } };
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* lagring er ikkje tilgjengeleg */ }
  seenListeners.forEach((listener) => listener());
}

export function useSeen() {
  return useSyncExternalStore((listener) => { seenListeners.add(listener); return () => seenListeners.delete(listener); }, () => seen);
}

export function isNewWish(data: DataValue, state: Seen, gift: Gift) {
  const list = data.listsById.get(gift.list);
  if (list?.kind !== 'wishes' || !list.person || list.person === data.myPerson?.id || gift.created_by === data.me.id || gift.archived) return false;
  return new Date(gift.created.replace(' ', 'T')).getTime() > (state.people[list.person] ?? state.base);
}

export function newWishCount(data: DataValue, state: Seen, personId: string) {
  return data.gifts.filter((g) => data.listsById.get(g.list)?.person === personId && isNewWish(data, state, g)).length;
}

export const newLabel = (n: number) => `${n} ${n === 1 ? 'nytt' : 'nye'}`;

/** Lagrar det eg veit om ein person i mitt private notat. Tomme felt tømmer notatet. */
export async function saveNote(data: DataValue, personId: string, fields: NoteFields) {
  const note = data.person_notes.find((n) => n.person === personId);
  if (note) await pb.collection('person_notes').update(note.id, fields);
  else await pb.collection('person_notes').create({ ...fields, user: data.me.id, person: personId });
  await data.reload('person_notes');
}
