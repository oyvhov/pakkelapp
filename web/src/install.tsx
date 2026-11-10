import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { Logo } from './ui';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
const KEY = 'install-nudge';
const WAIT_DAYS = 30;

const readPrompt = () => ((window as unknown as { installPrompt?: InstallPrompt }).installPrompt ?? null);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
// iPhone og iPad har ikkje installeringsknapp. Der må ein gå via Del-menyen i Safari.
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function snoozed() {
  try {
    const at = Number(localStorage.getItem(KEY) || 0);
    return Date.now() - at < WAIT_DAYS * 86400000;
  } catch { return false; }
}

/** Spør éin gong om brukaren vil leggje appen på heimskjermen. Kjem att etter ein månad om ein seier nei. */
export function InstallNudge() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(readPrompt);
  const [show, setShow] = useState(false);
  const ios = isIos();

  useEffect(() => {
    if (standalone() || snoozed()) return;
    const onReady = () => setPrompt(readPrompt());
    window.addEventListener('install-ready', onReady);
    // Lat appen kome på plass før vi spør.
    const t = window.setTimeout(() => setShow(true), 3500);
    return () => { window.removeEventListener('install-ready', onReady); window.clearTimeout(t); };
  }, []);

  if (!show || (!prompt && !ios)) return null;

  const close = () => {
    setShow(false);
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* */ }
  };
  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    (window as unknown as { installPrompt?: Event }).installPrompt = undefined;
    close();
  };

  return (
    <aside className="install-nudge" role="dialog" aria-label="Installer appen" aria-live="polite">
      <Logo size={40} />
      <div className="install-text">
        <strong>Legg Pakkelapp på heimskjermen</strong>
        {prompt
          ? <small>Då opnar appen seg som ein vanleg app, og du kan få varsel.</small>
          : <small>Trykk på <Share size={14} aria-label="Del" /> i Safari, og vel «Legg til på Hjem-skjerm». Då kan du òg få varsel.</small>}
      </div>
      <div className="install-actions">
        {prompt && <button type="button" className="btn small primary" onClick={() => void install()}><Download size={15} /> Installer</button>}
        <button type="button" className="icon-btn" aria-label="Ikkje no" onClick={close}><X size={18} /></button>
      </div>
    </aside>
  );
}
