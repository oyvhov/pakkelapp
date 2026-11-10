import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RecordModel } from 'pocketbase';
import { Bell, Bookmark, ChevronRight, Copy, Download, LogOut, ShieldCheck } from 'lucide-react';
import { applyTheme } from '../App';
import { useCrop } from '../crop';
import { useData } from '../data';
import { errorText, pb, readSeasonTheme, setSeasonTheme, shrinkImage, type SeasonTheme } from '../lib';
import { Avatar, Field, Segmented, Sheet, Switch, useToast } from '../ui';

type InstallPrompt = Event & { prompt: () => Promise<void> };
type Theme = 'auto' | 'light' | 'dark';
const readInstall = () => ((window as unknown as { installPrompt?: InstallPrompt }).installPrompt ?? null);

type PushKind = 'wishes' | 'payments' | 'chat' | 'reminders' | 'prices';
type PushRecord = RecordModel & Record<PushKind, boolean>;
const PUSH_KINDS: { id: PushKind; label: string; hint: string }[] = [
  { id: 'wishes', label: 'Nye ønske', hint: 'Når nokon du skal gje til, ønskjer seg noko.' },
  { id: 'payments', label: 'Betalingar og felles gåver', hint: 'Når nokon vil gjere opp, legg inn eit utlegg eller tek deg med på ei gåve.' },
  { id: 'chat', label: 'Hemmeleg prat', hint: 'Når nokon skriv om ei gåve du er med på.' },
  { id: 'reminders', label: 'Påminningar', hint: 'Før jul, og før bursdagar og andre høve.' },
  { id: 'prices', label: 'Prisfall', hint: 'På gåver du følgjer prisen på.' },
];

function worker() {
  // Utan service worker ville .ready aldri svart.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => { window.setTimeout(() => resolve(null), 1500); }),
  ]);
}

function keyBytes(key: string) {
  const raw = atob(`${key}${'='.repeat((4 - (key.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const findPush = (endpoint: string) => pb.collection('push_subs').getFirstListItem<PushRecord>(pb.filter('endpoint = {:e}', { e: endpoint })).catch(() => null);

/** Ein telefon som er logga ut, skal ikkje få varsel for den som var logga inn. */
async function forgetDevice() {
  try {
    const sub = await (await worker())?.pushManager.getSubscription();
    if (!sub) return;
    const record = await findPush(sub.endpoint);
    if (record) await pb.collection('push_subs').delete(record.id);
    await sub.unsubscribe();
  } catch { /* utlogginga skal gå uansett */ }
}

function PushPanel() {
  const data = useData();
  const toast = useToast();
  const [record, setRecord] = useState<PushRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const iPhone = /iphone|ipad/i.test(navigator.userAgent);

  useEffect(() => {
    if (!supported) { setLoading(false); return; }
    void (async () => {
      const sub = await (await worker())?.pushManager.getSubscription();
      if (sub) setRecord(await findPush(sub.endpoint));
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [supported]);

  const enable = async () => {
    if ((await Notification.requestPermission()) !== 'granted') {
      toast('Du må tillate varsel i nettlesaren for å få dei.');
      return;
    }
    const registration = await worker();
    if (!registration) { toast('Varsel er ikkje klare på denne eininga enno. Last sida på nytt.'); return; }
    const { key } = await pb.send<{ key: string }>('/api/jul/push/key', {});
    const sub = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    const json = sub.toJSON();
    setRecord(await pb.collection('push_subs').create<PushRecord>({
      user: data.me.id, endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth,
      wishes: true, payments: true, chat: true, reminders: true, prices: true,
    }));
  };
  const disable = async () => {
    if (record) await pb.collection('push_subs').delete(record.id);
    setRecord(null);
    await (await (await worker())?.pushManager.getSubscription())?.unsubscribe();
  };
  const toggle = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    try { await (on ? enable() : disable()); } catch (err) { toast(errorText(err, 'Kunne ikkje endre varsla.')); } finally { setBusy(false); }
  };
  const setKind = async (kind: PushKind, on: boolean) => {
    if (!record) return;
    setRecord({ ...record, [kind]: on });
    try { await pb.collection('push_subs').update(record.id, { [kind]: on }); } catch (err) { toast(errorText(err)); setRecord(record); }
  };

  return (
    <section className="panel">
      <h2><Bell size={18} /> Varsel</h2>
      {!supported ? (
        <p className="muted">{iPhone ? 'På iPhone må appen liggje på heimskjermen før han kan gje varsel. Trykk på Del-knappen i Safari og vel «Legg til på Hjem-skjerm», og opne appen derifrå.' : 'Denne nettlesaren støttar ikkje varsel.'}</p>
      ) : (
        <>
          <Switch checked={!!record} onChange={(v) => void toggle(v)} label="Varsel på denne eininga" hint={loading ? 'Sjekkar …' : 'Varsla viser ikkje kva gåva er.'} />
          {record && PUSH_KINDS.map((k) => <Switch key={k.id} checked={record[k.id]} onChange={(v) => void setKind(k.id, v)} label={k.label} hint={k.hint} />)}
        </>
      )}
    </section>
  );
}

function Bookmarklet() {
  const toast = useToast();
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // Sett her, for React nektar å skrive ut slike lenker sjølv.
    link.current?.setAttribute('href', `javascript:void(window.open('${window.location.origin}/del?url='+encodeURIComponent(location.href)))`);
  }, []);
  return (
    <section className="panel bookmarklet">
      <h2>Legg til frå PC-en</h2>
      <p className="muted">Dra knappen til bokmerkelinja. Bruk bokmerket på ei produktside for å leggje til gåva.</p>
      <a ref={link} className="btn gold" draggable onClick={(e) => { e.preventDefault(); toast('Dra knappen opp i bokmerkelinja.'); }}><Bookmark size={16} /> Legg i Pakkelapp</a>
    </section>
  );
}

export function SettingsPage() {
  const data = useData();
  const toast = useToast();
  const crop = useCrop();
  const navigate = useNavigate();
  const person = data.myPerson;
  const [name, setName] = useState(data.me.name);
  const [interests, setInterests] = useState(person?.interests ?? '');
  const [sizes, setSizes] = useState(person?.sizes ?? '');
  const [vipps, setVipps] = useState(person?.vipps ?? '');
  const [invite, setInvite] = useState('');
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('theme') as Theme) ?? 'auto'; } catch { return 'auto'; }
  });
  const [season, setSeason] = useState<SeasonTheme>(readSeasonTheme);
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [install, setInstall] = useState<InstallPrompt | null>(readInstall);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  const iPhone = /iphone|ipad/i.test(navigator.userAgent);

  useEffect(() => {
    pb.send<{ url: string }>('/api/jul/invite-link', {}).then((r) => setInvite(r.url)).catch(() => undefined);
    const onReady = () => setInstall(readInstall());
    window.addEventListener('install-ready', onReady);
    return () => window.removeEventListener('install-ready', onReady);
  }, []);

  const runInstall = async () => {
    await install?.prompt();
    (window as unknown as { installPrompt?: Event }).installPrompt = undefined;
    setInstall(null);
  };

  const changeTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    try { localStorage.setItem('theme', t); } catch { /* lagring er ikkje tilgjengeleg */ }
  };
  const changeSeason = (s: SeasonTheme) => {
    setSeason(s);
    setSeasonTheme(s);
  };
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); toast(label); } catch { toast(value); }
  };
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await pb.collection('users').update(data.me.id, { name: name.trim() });
      if (person) await pb.collection('people').update(person.id, { name: name.trim(), interests: interests.trim(), sizes: sizes.trim(), vipps: vipps.trim() });
      await Promise.all([data.reload('users'), data.reload('people')]);
      toast('Lagra');
      setEditing(false);
    } catch (err) { toast(errorText(err)); }
  };
  const uploadAvatar = async (file?: File) => {
    const cut = file && person ? await crop(file) : null;
    if (!cut || !person) return;
    file = cut;
    try {
      await pb.collection('people').update(person.id, { avatar: await shrinkImage(file) });
      await data.reload('people');
    } catch (err) { toast(errorText(err, 'Kunne ikkje lagre biletet.')); }
  };
  const setSimplify = async (on: boolean) => {
    if (!person) return;
    try {
      await pb.collection('people').update(person.id, { no_simplify: !on });
      await data.reload('people');
    } catch (err) { toast(errorText(err)); }
  };
  const logOut = async () => {
    await forgetDevice();
    navigate('/', { replace: true });
    pb.authStore.clear();
  };
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await pb.collection('users').update(data.me.id, { oldPassword, password, passwordConfirm: password });
      toast('Passordet er endra. Logg inn på nytt.');
      pb.authStore.clear();
    } catch (err) { toast(errorText(err, 'Kunne ikkje endre passordet.')); }
  };

  return (
    <div className="page narrow">
      <header className="page-head"><h1>Innstillingar</h1></header>

      <button type="button" className="admin-link profile-link" onClick={() => setEditing(true)}>
        <Avatar person={person} size={40} /><span><strong>{data.me.name || 'Profil'}</strong><small>Profil, bilete og storleikar</small></span><ChevronRight size={18} />
      </button>

      {data.me.is_owner && (
        <Link to="/admin" className="admin-link">
          <ShieldCheck size={20} /><span><strong>Administrasjon</strong><small>Medlemer, Nissen, invitasjon og backup</small></span><ChevronRight size={18} />
        </Link>
      )}

      <Sheet open={editing} onClose={() => setEditing(false)} title="Profil" protect>
        <div className="profile-top">
          <button type="button" className="avatar-pick" onClick={() => avatarInput.current?.click()}>
            <Avatar person={person} size={72} />
            <span>Byt bilete</span>
          </button>
          <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => { void uploadAvatar(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <form className="form" onSubmit={saveProfile}>
          <Field label="Namn"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></Field>
          <Field label="Interesser" hint="Alle med konto ser dette. Det hjelper dei, og Nissen, med å finne gåver til deg."><textarea rows={2} value={interests} onChange={(e) => setInterests(e.target.value)} maxLength={2000} /></Field>
          <div className="row-2">
            <Field label="Storleikar"><input value={sizes} onChange={(e) => setSizes(e.target.value)} maxLength={1000} /></Field>
            <Field label="Vipps-nummer"><input inputMode="tel" value={vipps} onChange={(e) => setVipps(e.target.value)} maxLength={30} /></Field>
          </div>
          <div className="form-actions"><button className="btn primary">Lagre</button></div>
        </form>
      </Sheet>

      <PushPanel />
      <Bookmarklet />

      <section className="panel">
        <h2>Oppgjer</h2>
        <Switch checked={!person?.no_simplify} onChange={(v) => void setSimplify(v)} label="Forenkla oppgjer" hint="Skuld kan samlast, så du kanskje betaler ein annan enn den du la ut saman med. Då blir det færre overføringar." />
      </section>

      <section className="panel">
        <h2>Utsjånad</h2>
        <Segmented label="Tema" value={theme} onChange={changeTheme} options={[{ id: 'auto', label: 'Som telefonen' }, { id: 'light', label: 'Lyst' }, { id: 'dark', label: 'Mørkt' }]} />
        <Segmented label="Sesong" value={season} onChange={changeSeason} options={[{ id: 'auto', label: 'Etter årstida' }, { id: 'jul', label: 'Jul' }, { id: 'fest', label: 'Feiring' }]} />
        <p className="field-hint">Etter årstida er jul frå november, og bursdagar og andre feiringar resten av året.</p>
        {install && <button className="btn ghost full" onClick={() => void runInstall()}><Download size={16} /> Installer appen</button>}
        {!install && iPhone && !standalone && <p className="field-hint">Vil du ha appen på heimskjermen? Trykk på Del-knappen i Safari og vel «Legg til på Hjem-skjerm».</p>}
      </section>

      <section className="panel">
        <h2>Inviter familien</h2>
        <p className="muted">Alle med denne lenka kan lage konto.</p>
        <div className="copy-row">
          <input readOnly value={invite} aria-label="Invitasjonslenke" onFocus={(e) => e.target.select()} />
          <button className="btn ghost" onClick={() => void copy(invite, 'Invitasjonslenka er kopiert')} disabled={!invite}><Copy size={16} /> Kopier</button>
        </div>
      </section>

      <section className="panel">
        <h2>Passord</h2>
        <form className="form" onSubmit={changePassword}>
          <Field label="Noverande passord"><input type="password" autoComplete="current-password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required /></Field>
          <Field label="Nytt passord"><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>
          <div className="form-actions"><button className="btn ghost">Endre passord</button></div>
        </form>
      </section>

      <button className="btn ghost full" onClick={() => void logOut()}><LogOut size={16} /> Logg ut</button>
    </div>
  );
}
