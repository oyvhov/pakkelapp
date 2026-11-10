import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellRing, Clock, RefreshCw, Smartphone, Sparkles } from 'lucide-react';
import { errorText, pb } from '../lib';
import { useToast } from '../ui';

interface Device { id: string; service: string; created: string; kinds: Record<string, boolean> }
interface Status { pushReady: boolean; devices: Device[]; aiReady: boolean; aiModel: string; serverTime: string; jul: boolean }
interface Report { sent: number; gone: number; errors: string[] }

const KINDS = [
  { id: 'wishes', label: 'Nye ønske' },
  { id: 'payments', label: 'Betalingar' },
  { id: 'chat', label: 'Hemmeleg prat' },
  { id: 'reminders', label: 'Påminningar' },
  { id: 'prices', label: 'Prisfall' },
];

const SERVICES: Record<string, string> = {
  'fcm.googleapis.com': 'Android eller Chrome',
  'web.push.apple.com': 'iPhone, iPad eller Safari',
  'updates.push.services.mozilla.com': 'Firefox',
};
const serviceName = (host: string) => SERVICES[host] ?? (host.includes('notify.windows.com') ? 'Edge på Windows' : host || 'Ukjend');

function describe(r: Report, devices: number, kind: string) {
  if (r.errors.length) return `Feil: ${r.errors[0]}`;
  if (r.sent > 0) return `Sendt til ${r.sent} ${r.sent === 1 ? 'eining' : 'einingar'}${r.gone ? `. ${r.gone} gamle einingar er fjerna.` : '.'}`;
  if (r.gone) return 'Eininga har slått av varsel. Slå dei på att under Innstillingar.';
  if (devices === 0) return 'Du har ikkje slått på varsel på nokon eining. Gjer det under Innstillingar.';
  return `Ingen av einingane dine har «${KINDS.find((k) => k.id === kind)?.label ?? kind}» slått på.`;
}

/** Testverktøy for administrator. Alt går berre til deg sjølv. */
export function AdminTests() {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';

  const load = useCallback(() => {
    pb.send<Status>('/api/jul/admin/test', {}).then(setStatus).catch((err) => toast(errorText(err)));
  }, [toast]);
  useEffect(load, [load]);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setResult('');
    try { setResult(await fn()); } catch (err) { setResult(errorText(err)); } finally { setBusy(''); load(); }
  };
  const push = (kind: string) => run(kind, async () => {
    const r = await pb.send<{ report: Report; devices: number }>('/api/jul/admin/test/push', { method: 'POST', body: { kind } });
    return describe(r.report, r.devices, kind);
  });
  const reminder = () => run('reminder', async () => {
    const r = await pb.send<{ report: Report; title: string; body: string }>('/api/jul/admin/test/reminder', { method: 'POST' });
    return `«${r.title}: ${r.body}» ${describe(r.report, status?.devices.length ?? 0, 'reminders')}`;
  });
  const nisse = () => run('nisse', async () => {
    const r = await pb.send<{ ok: boolean; ms: number; model: string; reply?: string; error?: string }>('/api/jul/admin/test/nisse', { method: 'POST' });
    return r.ok ? `Nissen svarte «${r.reply}» på ${(r.ms / 1000).toFixed(1)} s med ${r.model}.` : `Nissen svarte ikkje: ${r.error}`;
  });
  const local = () => run('local', async () => {
    if (permission !== 'granted') return 'Varsel er ikkje tillate i denne nettlesaren. Slå dei på under Innstillingar.';
    const reg = 'serviceWorker' in navigator ? await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => { window.setTimeout(() => r(null), 1500); })]) : null;
    if (!reg) return 'Appen sin service worker køyrer ikkje på denne eininga.';
    await reg.showNotification('Test: Pakkelapp', { body: 'Dette varselet kom berre frå denne eininga.', icon: '/icon-192.png', badge: '/icon-192.png' });
    return 'Vist på denne eininga, utan å gå via serveren.';
  });

  return (
    <section className="panel admin-tests">
      <h2>Test</h2>
      <p className="muted">Alt her går berre til deg sjølv. Ingen andre får varsel.</p>
      {!status ? <p className="muted">Hentar …</p> : (
        <>
          <dl className="test-facts">
            <div><dt>Varsel på serveren</dt><dd>{status.pushReady ? 'Klare' : 'Av'}</dd></div>
            <div><dt>Varsel i denne nettlesaren</dt><dd>{permission === 'granted' ? 'Tillate' : permission === 'denied' ? 'Blokkerte' : permission === 'unsupported' ? 'Ikkje støtta' : 'Ikkje spurt'}</dd></div>
            <div><dt>Nissen</dt><dd>{status.aiReady ? status.aiModel : 'Av'}</dd></div>
            <div><dt>Sesong på serveren</dt><dd>{status.jul ? 'Jul' : 'Resten av året'} · {new Date(status.serverTime).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })}</dd></div>
          </dl>

          <h3><Smartphone size={16} /> Einingane dine ({status.devices.length})</h3>
          {status.devices.length === 0
            ? <p className="muted">Ingen. <Link to="/meg">Slå på varsel under Innstillingar</Link> på kvar eining du vil teste.</p>
            : (
              <ul className="test-devices">
                {status.devices.map((d) => {
                  const off = KINDS.filter((k) => !d.kinds[k.id]).map((k) => k.label);
                  return <li key={d.id}><strong>{serviceName(d.service)}</strong><small>Lagt til {new Date(d.created).toLocaleDateString('nb-NO')}{off.length ? ` · Av: ${off.join(', ')}` : ' · Alle typar på'}</small></li>;
                })}
              </ul>
            )}

          <h3><BellRing size={16} /> Send testvarsel</h3>
          <div className="test-buttons">
            {KINDS.map((k) => <button key={k.id} className="btn ghost small" disabled={!!busy} onClick={() => void push(k.id)}><Bell size={14} /> {k.label}</button>)}
            <button className="btn ghost small" disabled={!!busy} onClick={() => void local()}><Smartphone size={14} /> Berre denne eininga</button>
          </div>

          <h3><Clock size={16} /> Ekte varsel</h3>
          <div className="test-buttons">
            <button className="btn ghost small" disabled={!!busy} onClick={() => void reminder()}><Clock size={14} /> Påminning før jul</button>
            {status.aiReady && <button className="btn ghost small" disabled={!!busy} onClick={() => void nisse()}><Sparkles size={14} /> Test Nissen</button>}
            <button className="btn ghost small" disabled={!!busy} onClick={load}><RefreshCw size={14} /> Oppdater</button>
          </div>
          <p className="muted test-note">Påminninga reknar ut kor mange du sjølv manglar gåve til, slik ho gjer for alle kvar morgon. Sesongen i appen kan du byte under Innstillingar.</p>

          <p className="test-result" role="status" aria-live="polite">{busy ? 'Sender …' : result}</p>
        </>
      )}
    </section>
  );
}
