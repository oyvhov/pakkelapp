import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Copy, DatabaseBackup, EyeOff, KeyRound, RefreshCw } from 'lucide-react';
import { useData } from '../data';
import { errorText, pb } from '../lib';
import { AdminTests } from './AdminTests';
import { Avatar, Field, LoadError, Sheet, Skeleton, Switch, useConfirm, useToast } from '../ui';

interface Overview {
  settings: { familyName: string; homeRegion: string; autoPrice: boolean; signupOpen: boolean; aiEnabled: boolean; aiModel: string; aiDailyLimit: number; simplify: boolean };
  aiKeySet: boolean;
  aiModels: string[];
  aiUsageToday: number;
  members: { id: string; name: string; email: string; isAdmin: boolean; disabled: boolean }[];
  backups: { count: number; last: string };
  inviteFixed: boolean;
  inviteUrl: string;
}

export function AdminPage() {
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [state, setState] = useState<Overview | null>(null);
  const [familyName, setFamilyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetUrl, setResetUrl] = useState('');
  const [failed, setFailed] = useState(false);

  const fetchOverview = useCallback(() => {
    setFailed(false);
    pb.send<Overview>('/api/jul/admin', {}).then((o) => { setState(o); setFamilyName(o.settings.familyName); }).catch(() => setFailed(true));
  }, []);
  useEffect(() => { if (data.me.is_owner) fetchOverview(); }, [data.me.is_owner, fetchOverview]);

  if (!data.me.is_owner) return <Navigate to="/meg" replace />;
  if (!state) return failed ? <LoadError onRetry={fetchOverview} /> : <Skeleton />;

  const apply = (o: Overview) => { setState(o); data.reloadConfig(); };
  const save = async (body: Record<string, unknown>) => {
    try { apply(await pb.send<Overview>('/api/jul/admin/settings', { method: 'PATCH', body })); } catch (err) { toast(errorText(err)); }
  };
  const member = async (id: string, body: Record<string, unknown>) => {
    try { apply(await pb.send<Overview>(`/api/jul/admin/members/${id}`, { method: 'PATCH', body })); } catch (err) { toast(errorText(err)); }
  };
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); toast(label); } catch { toast(value); }
  };
  const resetLink = async (userId: string, name: string) => {
    if (!(await confirm({ title: `Lage passordlenke for ${name}?`, body: 'Den som har lenka kan logge inn på kontoen. Vedkomande får beskjed i appen om at lenka er laga.', action: 'Lag lenke' }))) return;
    try {
      const r = await pb.send<{ url: string }>('/api/jul/admin/reset-link', { method: 'POST', body: { userId } });
      setResetUrl(r.url);
    } catch (err) { toast(errorText(err)); }
  };
  const rotate = async () => {
    if (!(await confirm({ title: 'Lage ny invitasjonslenke?', body: 'Den gamle lenka sluttar å verke med ein gong.', action: 'Lag ny', danger: true }))) return;
    try { apply(await pb.send<Overview>('/api/jul/admin/invite/rotate', { method: 'POST' })); toast('Ny lenke er klar'); } catch (err) { toast(errorText(err)); }
  };
  const backup = async () => {
    setBusy(true);
    try { apply(await pb.send<Overview>('/api/jul/admin/backup', { method: 'POST' })); toast('Backup er teken'); } catch (err) { toast(errorText(err)); } finally { setBusy(false); }
  };

  const models = state.aiModels.includes(state.settings.aiModel) ? state.aiModels : [state.settings.aiModel, ...state.aiModels];
  return (
    <div className="page narrow">
      <Link className="back" to="/meg"><ArrowLeft size={18} /> Innstillingar</Link>
      <header className="page-head"><h1>Administrasjon</h1></header>

      <p className="privacy-note"><EyeOff size={18} /><span>Administrator har same innsyn i ønske, kjøp og lister som andre medlemer.</span></p>

      <section className="panel">
        <h2>Familien</h2>
        <Field label="Namn på familien">
          <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} onBlur={() => familyName !== state.settings.familyName && void save({ familyName })} maxLength={80} />
        </Field>
        <Switch checked={state.settings.signupOpen} onChange={(signupOpen) => void save({ signupOpen })} label="Opent for nye medlemer" hint="Slå av når alle er med, så verkar ikkje invitasjonslenka lenger." />
        <div className="copy-row">
          <input readOnly value={state.inviteUrl} aria-label="Invitasjonslenke" onFocus={(e) => e.target.select()} />
          <button className="icon-btn" onClick={() => void copy(state.inviteUrl, 'Kopiert')} aria-label="Kopier lenka"><Copy size={17} /></button>
          {!state.inviteFixed && <button className="icon-btn" onClick={() => void rotate()} aria-label="Lag ny lenke"><RefreshCw size={17} /></button>}
        </div>
      </section>

      <section className="panel">
        <h2>Medlemer</h2>
        <div className="admin-members">
          {state.members.map((m) => (
            <div className={`admin-member ${m.disabled ? 'paused' : ''}`} key={m.id}>
              <Avatar person={data.people.find((p) => p.user === m.id)} size={38} />
              <span className="admin-member-text"><strong>{m.name}</strong><small>{m.email}</small></span>
              <div className="admin-member-actions">
                <button className={`filter small ${m.isAdmin ? 'on' : ''}`} disabled={m.id === data.me.id} onClick={() => void member(m.id, { isAdmin: !m.isAdmin })}>Admin</button>
                {m.id !== data.me.id && <button className={`filter small ${m.disabled ? 'on' : ''}`} onClick={() => void member(m.id, { disabled: !m.disabled })}>{m.disabled ? 'På pause' : 'Pause'}</button>}
                {m.id !== data.me.id && <button className="icon-btn small" onClick={() => void resetLink(m.id, m.name)} aria-label={`Nytt passord for ${m.name}`} title="Lenke for nytt passord"><KeyRound size={15} /></button>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Nissen</h2>
        {!state.aiKeySet && <p className="note-bar">OPENAI_API_KEY manglar på serveren, så Nissen og prissjekken er av.</p>}
        <Switch checked={state.settings.aiEnabled} onChange={(aiEnabled) => void save({ aiEnabled })} label="Nissen og prissjekk" />
        <Switch checked={state.settings.autoPrice} onChange={(autoPrice) => void save({ autoPrice })} label="Automatisk prissjekk" hint="Sjekkar prisen når ei ny gåve blir lagt til. Kvar sjekk er eit lite nettsøk på OpenAI-kontoen." />
        <Field label="Kvar bur familien?" hint="Nissen foreslår berre opplevingar og butikkar her. Nettbutikkar som sender heim er alltid med.">
          <input defaultValue={state.settings.homeRegion} maxLength={80} onBlur={(e) => { const v = e.target.value.trim(); if (v !== state.settings.homeRegion) void save({ homeRegion: v }); }} />
        </Field>
        <Field label="Modell" hint={`${state.aiUsageToday} førespurnader i dag`}>
          <select value={state.settings.aiModel} onChange={(e) => void save({ aiModel: e.target.value })}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Maks per person per døgn">
          <input inputMode="numeric" defaultValue={state.settings.aiDailyLimit} onBlur={(e) => { const v = Number(e.target.value); if (v && v !== state.settings.aiDailyLimit) void save({ aiDailyLimit: v }); }} />
        </Field>
      </section>

      <section className="panel">
        <h2>Oppgjer</h2>
        <Switch checked={state.settings.simplify} onChange={(simplify) => void save({ simplify })} label="Tillat forenkla oppgjer" hint="Den enkelte kan framleis seie nei under sine eigne innstillingar." />
      </section>

      <section className="panel">
        <h2>Backup</h2>
        <p className="muted">{state.backups.count} backupar lagra{state.backups.last ? `, sist ${new Date(state.backups.last).toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. Det blir teke backup kvar natt.</p>
        <button className="btn ghost" onClick={() => void backup()} disabled={busy}><DatabaseBackup size={16} /> {busy ? 'Tek backup …' : 'Ta backup no'}</button>
      </section>

      <AdminTests />

      <Sheet open={!!resetUrl} onClose={() => setResetUrl('')} title="Lenke for nytt passord">
        <p className="muted">Send denne lenka til vedkomande. Ho gjeld berre éin gong.</p>
        <div className="copy-row spaced-row">
          <input readOnly value={resetUrl} aria-label="Lenke for nytt passord" onFocus={(e) => e.target.select()} />
          <button className="btn ghost" onClick={() => void copy(resetUrl, 'Lenka er kopiert')}><Copy size={16} /> Kopier</button>
        </div>
      </Sheet>
    </div>
  );
}
