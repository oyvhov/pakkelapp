import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { Bow } from './decor';
import { COLORS, errorText, fileUrl, pb, type Gift, type Person } from './lib';
import { isRecipient, useData, useMaybeData } from './data';

/* Logoen følgjer sesongen: hjarte og gullstjerne i jula, stjerne og konfetti resten av året. Fargane på flata kjem frå --pine. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g className="logo-tag">
        <g transform="rotate(-24 32 32)">
          <path d="M10 32L20 21H52a4 4 0 0 1 4 4V39a4 4 0 0 1-4 4H20Z" fill="#fbf3e0" />
          <circle cx="19.5" cy="32" r="3.4" style={{ fill: 'var(--pine)' }} />
          <path className="logo-jul" d="M38 40.5c-6.5-4.4-8.6-7.4-8.6-10.2 0-2.5 1.9-4.3 4.2-4.3 1.9 0 3.4 1.1 4.4 2.7 1-1.6 2.5-2.7 4.4-2.7 2.3 0 4.2 1.8 4.2 4.3 0 2.8-2.1 5.8-8.6 10.2z" fill="#a8233b" />
          <path className="logo-fest" d="M38 22.5l2.7 6.8 6.8 2.7-6.8 2.7L38 41.5l-2.7-6.8-6.8-2.7 6.8-2.7z" fill="#e0566e" />
        </g>
        <path d="M20.6 37C11 30 9 20 14 8" fill="none" stroke="#e8c67c" strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <path className="logo-spark logo-jul" d="M52 5l1.5 4.2 4.2 1.5-4.2 1.5L52 16.4l-1.5-4.2-4.2-1.5 4.2-1.5z" fill="#e8c67c" />
      <g className="logo-spark logo-fest">
        <circle cx="49" cy="9" r="2.4" fill="#e8c67c" />
        <rect x="54" y="13" width="4.4" height="2.4" rx="1.2" transform="rotate(35 56 14)" fill="#7fc8b6" />
        <circle cx="57" cy="6" r="1.7" fill="#e0566e" />
      </g>
    </svg>
  );
}

export function FadeImg({ src, alt = '' }: { src: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  return <img src={src} alt={alt} loading="lazy" className={`fade ${loaded ? 'in' : ''}`} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />;
}

export function Avatar({ person, size = 40, large }: { person?: Person; size?: number; large?: boolean }) {
  const initials = (person?.name ?? '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  const data = useMaybeData();
  // Har personen ikkje eige bilete, vis eit privat bilete eg har lagt inn sjølv.
  const own = !person?.avatar && person ? data?.photos.find((p) => p.person === person.id) : undefined;
  // Dei små førehandsbileta blir uskarpe på store avatarar.
  const url = !person ? '' : own ? fileUrl(own, own.image, large ? undefined : '160x160') : fileUrl(person, person.avatar, large ? undefined : '160x160');
  return (
    <span className="avatar" data-i={url ? undefined : initials} style={{ width: size, height: size, fontSize: size * 0.38, background: person?.color || COLORS[1] }} aria-hidden="true">
      {url && <img src={url} alt="" />}
    </span>
  );
}

/* Tilbake-knappen skal lukke arket som er ope, ikkje forlate sida. Kvart ope ark har ein stopp i historikken. */
const openSheets: { close: () => void }[] = [];
let guardTimer = 0;
const guardDepth = () => (history.state?.sheet as number | undefined) ?? 0;

function syncGuards() {
  window.clearTimeout(guardTimer);
  guardTimer = window.setTimeout(() => {
    const extra = guardDepth() - openSheets.length;
    if (extra > 0) history.go(-extra);
  }, 60);
}

window.addEventListener('popstate', (e) => {
  const depth = (e.state?.sheet as number | undefined) ?? 0;
  if (depth > openSheets.length) history.go(openSheets.length - depth); // Ein stopp etter eit ark som alt er lukka.
  else if (depth < openSheets.length) openSheets[openSheets.length - 1].close();
});

export function Sheet({ open, onClose, title, children, footer, protect }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; protect?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const last = useRef({ title, children, footer });
  if (open) last.current = { title, children, footer };
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  const dirty = useRef(false);
  const confirm = useContext(ConfirmContext);

  useEffect(() => {
    const dialog = ref.current;
    if (open) {
      setClosing(false);
      setMounted(true);
      dirty.current = false;
      if (mounted && dialog && !dialog.open) {
        dialog.showModal();
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
          dialog.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus({ preventScroll: true });
        }
      }
      if (dialog) dialog.style.transform = '';
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = window.setTimeout(() => {
      dialog?.close();
      setClosing(false);
      setMounted(false);
    }, 190);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  // Eit skjema med innhald skal ikkje forsvinne ved eit feiltrykk.
  const requestClose = async () => {
    if (protect && dirty.current && !(await confirm({ title: 'Forkaste det du har skrive?', action: 'Forkast', danger: true }))) {
      if (ref.current) ref.current.style.transform = '';
      return;
    }
    onClose();
  };

  const closeFromHistory = useRef(() => undefined as void);
  closeFromHistory.current = () => {
    // Arket kan bli ståande om brukaren angrar, så stoppen må på plass igjen.
    if (protect && dirty.current) history.pushState({ ...history.state, sheet: openSheets.length }, '');
    void requestClose();
  };

  useEffect(() => {
    if (!open) return;
    const entry = { close: () => closeFromHistory.current() };
    openSheets.push(entry);
    const state = { ...history.state, sheet: openSheets.length };
    // Går eitt ark rett over i eit anna, gjenbruker det nye stoppen til det førre.
    if (guardDepth() >= openSheets.length) history.replaceState(state, '');
    else history.pushState(state, '');
    return () => {
      openSheets.splice(openSheets.indexOf(entry), 1);
      syncGuards();
    };
  }, [open]);

  const onDown = (e: ReactPointerEvent) => {
    if (!e.isPrimary || e.button !== 0 || !window.matchMedia('(max-width: 639px)').matches || (e.target as Element).closest('button')) return;
    drag.current = { startY: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (ref.current) ref.current.style.transition = 'none';
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current || !ref.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.startY);
    ref.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onUp = () => {
    if (!drag.current || !ref.current) return;
    const { dy } = drag.current;
    drag.current = null;
    ref.current.style.transition = '';
    if (dy > 90) void requestClose();
    else ref.current.style.transform = '';
  };

  const view = open ? { title, children, footer } : last.current;
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      className={`sheet ${closing ? 'closing' : ''}`}
      onCancel={(e) => { e.preventDefault(); void requestClose(); }}
      onClose={() => { if (open) onClose(); }}
      onMouseDown={(e) => { if (e.target === ref.current) void requestClose(); }}
    >
      {mounted && (
        <div className="sheet-inner">
          <header className="sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => {
            drag.current = null;
            if (ref.current) { ref.current.style.transition = ''; ref.current.style.transform = ''; }
          }}>
            <span className="grabber" aria-hidden="true" />
            <h2 id={headingId}>{view.title}</h2>
            <button type="button" className="icon-btn" onClick={() => void requestClose()} aria-label="Lukk"><X size={20} /></button>
          </header>
          <div
            className="sheet-body"
            onInput={() => { dirty.current = true; }}
            onClick={(e) => { if ((e.target as Element).closest('.chip, .segmented button, .picker-option, .swatches button, [role="switch"], .image-remove, .link-pill button')) dirty.current = true; }}
          >{view.children}</div>
          {view.footer && <footer className="sheet-foot">{view.footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row" onClick={() => onChange(!checked)}>
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <i className={`switch ${checked ? 'on' : ''}`} aria-hidden="true" />
    </button>
  );
}

/** Piltastar flyttar mellom vala, slik ei radiogruppe skal oppføre seg. */
export function radioKeys(e: KeyboardEvent<HTMLElement>, count: number, index: number, choose: (i: number) => void) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const next = (index + step + count) % count;
  choose(next);
  e.currentTarget.querySelectorAll('button')[next]?.focus();
}

export function Segmented<T extends string>({ value, options, onChange, label, className = '' }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string }) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div
      className={`segmented ${className}`} role="radiogroup" aria-label={label}
      style={{ ['--n' as string]: options.length, ['--i' as string]: index }}
      onKeyDown={(e) => radioKeys(e, options.length, index, (i) => onChange(options[i].id))}
    >
      <i className="segmented-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" tabIndex={value === o.id ? 0 : -1} aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

let personBeingAdded: Promise<void> | null = null;
export const personBusy = () => personBeingAdded !== null;
export const waitForPerson = () => personBeingAdded ?? Promise.resolve();

/** Nedtrekksmeny med fleirval. Berre dei som er valde, synest når menyen er lukka. */
export function PersonPicker({ label, value, onChange, exclude, single, placeholder = 'Vel person' }: { label: string; value: string[]; onChange: (ids: string[]) => void; exclude?: string; single?: boolean; placeholder?: string }) {
  const data = useData();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const pickerId = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const toggle = (id: string) => {
    if (single) { onChange(value.includes(id) ? [] : [id]); setOpen(false); }
    else onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // Tastaturet skal ikkje sprette opp på telefon før nokon faktisk vil søkje.
    if (window.matchMedia('(hover: hover)').matches) search.current?.focus();
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const create = async (clean: string) => {
    const existing = data.people.find((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      if (!value.includes(existing.id)) onChange(single ? [existing.id] : [...value, existing.id]);
    } else {
      const color = COLORS[data.people.length % COLORS.length];
      const person = await pb.collection('people').create<Person>({ name: clean, color, created_by: data.me.id });
      await data.reload('people');
      onChange(single ? [person.id] : [...value, person.id]);
    }
    setQuery('');
  };

  const clean = query.trim();
  const people = data.people.filter((p) => p.id !== exclude).sort((a, b) => Number(isRecipient(data, b.id)) - Number(isRecipient(data, a.id)));
  const filtered = clean ? people.filter((p) => p.name.toLowerCase().includes(clean.toLowerCase())) : people;
  const exact = data.people.some((p) => p.name.toLowerCase() === clean.toLowerCase());
  const selected = value.map((id) => data.peopleById.get(id)).filter((p): p is Person => !!p);
  const nameOf = (p: Person) => (p.id === data.myPerson?.id ? 'Meg' : p.name);

  // Eit nytt namn som er skrive inn, skal bli med òg om ein går rett vidare til Lagre.
  const add = () => {
    if (!clean || running.current) return;
    running.current = true;
    personBeingAdded = create(clean)
      .catch((err) => toast(errorText(err)))
      .finally(() => { running.current = false; personBeingAdded = null; });
  };

  return (
    <div
      className="field picker" ref={root}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}
    >
      <span className="field-label" id={`${pickerId}-label`}>{label}</span>
      <button
        type="button" id={pickerId} className={`picker-trigger ${open ? 'open' : ''}`} aria-haspopup="listbox" aria-expanded={open}
        aria-labelledby={`${pickerId}-label ${pickerId}`} onClick={() => setOpen(!open)}
      >
        {selected.length > 0 ? (
          <span className="picker-tags">
            {selected.map((p) => <span className="picker-tag" key={p.id}><Avatar person={p} size={22} />{nameOf(p)}</span>)}
          </span>
        ) : <span className="picker-placeholder">{placeholder}</span>}
        <ChevronDown size={18} className="picker-chevron" />
      </button>
      {open && (
        <div className="picker-panel" ref={panel}>
          <span className="input-icon compact">
            <Search size={16} />
            <input
              ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Søk, eller skriv eit nytt namn" aria-label={`Søk etter person for ${label}`}
              onBlur={() => { if (clean && filtered.length === 0) add(); }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (filtered.length === 1) { toggle(filtered[0].id); setQuery(''); } else if (clean && !exact) add();
              }}
            />
          </span>
          <div className="picker-list" role="listbox" aria-multiselectable={!single} aria-label={label}>
            {filtered.map((p) => {
              const on = value.includes(p.id);
              return (
                <button key={p.id} type="button" role="option" aria-selected={on} className={`picker-option ${on ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(p.id)}>
                  <Avatar person={p} size={30} />
                  <span className="picker-name">{nameOf(p)}{p.relation && <small>{p.relation}</small>}</span>
                  <i className="picker-check" aria-hidden="true">{on && <Check size={14} strokeWidth={3} />}</i>
                </button>
              );
            })}
            {filtered.length === 0 && !clean && <p className="picker-empty">Ingen personar enno.</p>}
          </div>
          {clean && !exact && (
            <button type="button" className="picker-add" onMouseDown={(e) => e.preventDefault()} onClick={add}><Plus size={16} /> Legg til «{clean}»</button>
          )}
          <button type="button" className="picker-done" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(false)}>Ferdig</button>
        </div>
      )}
    </div>
  );
}

export function GiftImage({ gift, thumb = '480x480' }: { gift: Gift; thumb?: string }) {
  const url = fileUrl(gift, gift.image, thumb);
  if (url) return <FadeImg src={url} />;
  const wrap = WRAPS[Array.from(gift.id).reduce((sum, c) => sum + c.charCodeAt(0), 0) % WRAPS.length];
  return <span className="gift-wrap" style={{ ['--paper' as string]: wrap.paper, ['--ribbon' as string]: wrap.ribbon }}><Bow /></span>;
}

const WRAPS = [
  { paper: '#8f2134', ribbon: '#e2bd72' },
  { paper: '#24524a', ribbon: '#e2bd72' },
  { paper: '#b88a35', ribbon: '#fbf3e0' },
  { paper: '#efe3d0', ribbon: '#a8233b' },
];

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Lastar">
      <div className="skeleton sk-hero" />
      <div className="sk-row">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton sk-round" />)}</div>
      <div className="gift-grid">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton sk-card" />)}</div>
    </div>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="page">
      <Empty title="Fekk ikkje kontakt" action={<button className="btn primary" onClick={onRetry}>Prøv igjen</button>}>Sjekk nett­sambandet.</Empty>
    </div>
  );
}

export type ToastAction = { label: string; onClick: () => void };
const ToastContext = createContext<(msg: string, action?: ToastAction | ToastAction[], ms?: number) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; actions: ToastAction[] } | null>(null);
  const timer = useRef(0);
  const host = useRef<HTMLDivElement>(null);
  const show = useCallback((message: string, action?: ToastAction | ToastAction[], ms?: number) => {
    const actions = action ? (Array.isArray(action) ? action : [action]) : [];
    setToast({ id: Date.now(), message, actions });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), ms ?? (actions.length ? 6000 : 3600));
  }, []);

  // Eit opna ark ligg øvst i nettlesaren. Som popover kjem varselet over arket i staden for under.
  useEffect(() => {
    const el = host.current;
    if (!el?.showPopover) return;
    try { el.hidePopover(); } catch { /* var ikkje open */ }
    if (toast) el.showPopover();
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div ref={host} popover="manual" className="toast-wrap" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span>{toast.message}</span>
            {toast.actions.map((a) => <button key={a.label} onClick={() => { a.onClick(); setToast(null); }}>{a.label}</button>)}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

interface ConfirmOptions { title: string; body?: string; action: string; danger?: boolean }
const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => true);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [open, setOpen] = useState(false);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => { setState({ ...o, resolve }); setOpen(true); }), []);
  const finish = (v: boolean) => { state?.resolve(v); setOpen(false); };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Sheet open={open} onClose={() => finish(false)} title={state?.title ?? ''}>
        {state?.body && <p className="muted">{state.body}</p>}
        <div className="form-actions confirm-actions">
          <button className="btn ghost" onClick={() => finish(false)}>Avbryt</button>
          <button className={`btn ${state?.danger ? 'primary' : 'gold'}`} onClick={() => finish(true)}>{state?.action}</button>
        </div>
      </Sheet>
    </ConfirmContext.Provider>
  );
}
