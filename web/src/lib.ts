import PocketBase, { type RecordModel } from 'pocketbase';

export const pb = new PocketBase('/');
pb.autoCancellation(false);

export type Status = 'idea' | 'bought' | 'wrapped' | 'given';

export interface User extends RecordModel {
  name: string;
  avatar: string;
  color: string;
  is_owner: boolean;
  password_reset_at: string;
}
export interface Person extends RecordModel {
  name: string;
  relation: string;
  color: string;
  birth_year: number;
  gender: '' | 'female' | 'male' | 'other';
  age_group: '' | 'child' | 'teen' | 'adult' | 'elder';
  interests: string;
  sizes: string;
  budget: number;
  avatar: string;
  vipps: string;
  no_simplify: boolean;
  covered_by: string;
  covered_request: string;
  covered_request_by: string;
  user: string;
  created_by: string;
}
export interface GiftList extends RecordModel {
  name: string;
  description: string;
  kind: 'wishes' | 'plan';
  visibility: 'private' | 'family' | 'shared';
  year: number;
  budget: number;
  occasion: '' | Occasion;
  event_date: string;
  share_token: string;
  owner: string;
  person: string;
  editors: string[];
  viewers: string[];
}
export type Occasion = 'jul' | 'birthday' | 'confirmation' | 'wedding' | 'other';
export interface Gift extends RecordModel {
  list: string;
  title: string;
  url: string;
  shop: string;
  note: string;
  rhyme: string;
  price: number;
  priority: number;
  status: Status | '';
  image: string;
  recipients: string[];
  givers: string[];
  best_price: number;
  best_shop: string;
  best_url: string;
  best_checked: string;
  offers: Offer[] | null;
  watch_price: boolean;
  archived: boolean;
  created_by: string;
  shared_with: string[];
}
export interface Offer {
  shop: string;
  product: string;
  price: number;
  currency: string;
  url: string;
  note: string;
  verified: boolean;
}
export interface Claim extends RecordModel {
  gift: string;
  user: string;
  status: 'reserved' | 'bought';
  amount: number;
  year: number;
  guest_name?: string;
}
export interface GuestClaim extends RecordModel {
  gift: string;
  name: string;
  year: number;
}
export interface Comment extends RecordModel {
  gift: string;
  user: string;
  text: string;
}
/** Eit bilete av ein annan person som berre eg ser. */
/** Det eg veit om ein person. Berre eg ser det. */
export interface PersonNote extends RecordModel {
  user: string;
  person: string;
  relation: string;
  birth_year: number;
  gender: Person['gender'];
  age_group: Person['age_group'];
  interests: string;
  sizes: string;
}
export const NOTE_FIELDS = ['relation', 'birth_year', 'gender', 'age_group', 'interests', 'sizes'] as const;
export type NoteFields = Partial<Pick<PersonNote, (typeof NOTE_FIELDS)[number]>>;

export interface PrivatePhoto extends RecordModel {
  user: string;
  person: string;
  image: string;
}

export interface RecipientMark extends RecordModel {
  user: string;
  person: string;
  year: number;
  budget: number;
  done: boolean;
  sort: number;
}
export interface Share {
  person: string;
  weight: number;
  fixed?: number;
}
export interface Expense extends RecordModel {
  title: string;
  note: string;
  kind: 'expense' | 'refund';
  amount: number;
  currency: string;
  original_amount: number;
  spent_on: string;
  year: number;
  gift: string;
  payers: { person: string; ore: number }[];
  shares: Share[];
  allocated: Record<string, number>;
  parties: string[];
  payer_users: string[];
  disputed_by: string[];
  created_by: string;
}
export interface Settlement extends RecordModel {
  from_person: string;
  to_person: string;
  amount: number;
  kind: 'paid' | 'waived';
  status: 'pending' | 'confirmed';
  method: '' | 'vipps' | 'bank' | 'cash' | 'other';
  note: string;
  receivers: string[];
  created_by: string;
}
export interface Transfer {
  from: string;
  to: string;
  ore: number;
  simplified: boolean;
}
export interface Ledger {
  me: string;
  owe: number;
  owed: number;
  transfers: Transfer[];
  wallets: Record<string, string>;
  disputed: number;
}

export const STATUSES: { id: Status; label: string }[] = [
  { id: 'idea', label: 'Idé' },
  { id: 'bought', label: 'Kjøpt' },
  { id: 'wrapped', label: 'Pakka' },
  { id: 'given', label: 'Gjeve' },
];

export const PRIORITIES = ['Fint å få', 'Gjerne', 'Mest ønskt'];

export const COLORS = ['#a8233b', '#24524a', '#b88a35', '#5a4a8c', '#2b6f8f', '#b5562b', '#6b7a2f', '#8c3f6b'];

const krFormat = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });
const oreFormat = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const kr = (n: number) => `${krFormat.format(n)} kr`;
export const money = (ore: number) => `${ore % 100 === 0 ? krFormat.format(ore / 100) : oreFormat.format(ore / 100)} kr`;

export const OCCASIONS: { id: Occasion; label: string }[] = [
  { id: 'jul', label: 'Jul' },
  { id: 'birthday', label: 'Bursdag' },
  { id: 'confirmation', label: 'Konfirmasjon' },
  { id: 'wedding', label: 'Bryllup' },
  { id: 'other', label: 'Anna høve' },
];

export const isJul = (list?: Pick<GiftList, 'occasion'>) => !list?.occasion || list.occasion === 'jul';

export function untilText(date: string) {
  if (!date) return '';
  const target = new Date(`${date.slice(0, 10)}T00:00:00`);
  const now = new Date();
  const days = Math.round((target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  if (Number.isNaN(days)) return '';
  if (days < 0) return 'Har vore';
  if (days === 0) return 'I dag';
  return days === 1 ? 'I morgon' : `Om ${days} dagar`;
}

export function listLabel(list: GiftList) {
  const kind = list.kind === 'wishes' ? 'Ønskeliste' : isJul(list) ? `Gåveplan ${list.year}` : 'Gåveplan';
  if (isJul(list)) return kind;
  return [OCCASIONS.find((o) => o.id === list.occasion)?.label, kind, untilText(list.event_date)].filter(Boolean).join(' · ');
}

const AMOUNT = /^(\d{1,3}([.,]\d{3})+([.,]\d+)?|\d+([.,]\d+)?)$/;
const cleanAmount = (value: string) => value.toLowerCase().replace(/kr|nok|\s/g, '').replace(/[.,]?-+$/, '');

/** Forstår slik folk faktisk skriv prisar: «299 kr», «299,-», «1 299», «1.299,50» og «49,90». Alt anna er 0. */
export function parseAmount(value: string) {
  let s = cleanAmount(value);
  if (!AMOUNT.test(s)) return 0;
  const sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (sep >= 0 && s.length - sep - 1 !== 3) s = `${s.slice(0, sep).replace(/[.,]/g, '')}.${s.slice(sep + 1)}`;
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Sant når det står noko i feltet som ikkje kan lesast som eit beløp, til dømes «-10». */
export function badAmount(value: string) {
  return value.trim() !== '' && !AMOUNT.test(cleanAmount(value));
}

export function firstName(name?: string) {
  return (name ?? '').split(' ')[0];
}

export function seasonYear(now = new Date()) {
  return now.getMonth() === 11 && now.getDate() > 26 ? now.getFullYear() + 1 : now.getFullYear();
}

export function christmas(now = new Date()) {
  const eve = new Date(seasonYear(now), 11, 24);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((eve.getTime() - today.getTime()) / 86400000);
  const firstAdvent = new Date(eve.getFullYear(), 11, 25);
  firstAdvent.setDate(25 - (firstAdvent.getDay() || 7) - 21);
  return { days, firstAdvent };
}

/* Sesongen: jul frå november til og med 2. juledag, feiring resten av året. Valet ligg på eininga. */
export type SeasonTheme = 'auto' | 'jul' | 'fest';
const SEASON_KEY = 'season-theme';

export function readSeasonTheme(): SeasonTheme {
  try {
    const value = localStorage.getItem(SEASON_KEY);
    return value === 'jul' || value === 'fest' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function isFest(theme = readSeasonTheme(), now = new Date()) {
  if (theme !== 'auto') return theme === 'fest';
  const month = now.getMonth();
  return !(month === 10 || (month === 11 && now.getDate() <= 26));
}

export function applySeason() {
  const fest = isFest();
  document.documentElement.dataset.season = fest ? 'fest' : 'jul';
  // Fanen og fargelinja i nettlesaren følgjer same sesong som appen.
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = fest ? '/favicon-fest.svg' : '/favicon.svg';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', fest ? '#2f2b5a' : '#17372f');
}

export function setSeasonTheme(theme: SeasonTheme) {
  try { localStorage.setItem(SEASON_KEY, theme); } catch { /* lagring er ikkje tilgjengeleg */ }
  applySeason();
  window.dispatchEvent(new Event('season-change'));
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Dagar til ei feiring. 0 er i dag, negativt er forbi. */
export function daysUntil(date: string, now = new Date()) {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - dayStart(now)) / 86400000);
}

/** Ei feiring er aktuell til dagen er over. Utan dato veit vi ikkje, og då held vi ho framme. */
export const isUpcoming = (list: Pick<GiftList, 'event_date'>) => !list.event_date || daysUntil(list.event_date) >= 0;

export function isHttpUrl(value: string) {
  try {
    const u = new URL(value.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && /^[^.]+(\.[^.]+)*\.[a-z]{2,}$/i.test(u.hostname);
  } catch {
    return false;
  }
}

let fileToken = '';
let fileTokenAt = 0;

/** Gåvebilete er verna, så adressa treng ein kortliva nøkkel. */
export async function refreshFileToken() {
  fileToken = await pb.files.getToken();
  fileTokenAt = Date.now();
}
export const fileTokenStale = () => Date.now() - fileTokenAt > 12 * 3600 * 1000;

/** Bilete frå mobilen er store. Skalerer ned før opplasting, og sender originalen om det ikkje går. */
export async function shrinkImage(file: File, max = 640): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.86));
    return blob ? new File([blob], 'bilete.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

export function fileUrl(record: RecordModel, name: string, thumb?: string) {
  if (!name) return '';
  const query: Record<string, string> = {};
  if (thumb) query.thumb = thumb;
  if ((record.collectionName === 'gifts' || record.collectionName === 'photos') && fileToken) query.token = fileToken;
  return pb.files.getURL(record, name, query);
}

const SERVER_ERRORS: Record<string, string> = {
  validation_invalid_old_password: 'Det noverande passordet er feil.',
  validation_not_unique: 'Dette er allereie i bruk.',
  validation_is_email: 'Det ser ikkje ut som ei e-postadresse.',
  validation_required: 'Noko du må fylle ut, manglar.',
  validation_length_too_short: 'Teksten er for kort.',
  validation_length_too_long: 'Teksten er for lang.',
  validation_file_size_limit: 'Biletet er for stort. Prøv eit mindre bilete.',
  validation_invalid_mime_type: 'Biletformatet er ikkje støtta. Bruk JPG eller PNG.',
};

/** Feilmeldingar skal vere på nynorsk, sjølv om PocketBase svarar på engelsk. */
export function errorText(err: unknown, fallback = 'Noko gjekk gale. Prøv igjen.') {
  const e = err as { response?: { message?: string; data?: Record<string, { message?: string; code?: string }> }; status?: number };
  if (e?.status === 0) return 'Fekk ikkje kontakt med serveren. Sjekk nettet og prøv igjen.';
  const field = e?.response?.data ? Object.values(e.response.data)[0] : undefined;
  if (field?.code && SERVER_ERRORS[field.code]) return SERVER_ERRORS[field.code];
  if (field?.code === 'validation_invalid' && field.message) return field.message;
  const message = e?.response?.message ?? '';
  if (!message || /^(Failed|Something|The requested|Only|Missing|Too many|An error)/i.test(message)) return fallback;
  return message;
}

export function canEditList(list: GiftList | undefined, userId: string) {
  if (!list) return false;
  return list.owner === userId || (list.visibility === 'shared' && list.editors.includes(userId));
}

export function names(ids: string[], people: Map<string, Person>) {
  return ids.map((id) => people.get(id)?.name).filter(Boolean).join(', ');
}

export function shortNames(ids: string[], people: Map<string, Person>) {
  return ids.map((id) => firstName(people.get(id)?.name)).filter(Boolean).join(', ');
}

export function haptic() {
  try { navigator.vibrate?.(8); } catch { /* ikkje støtta */ }
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
