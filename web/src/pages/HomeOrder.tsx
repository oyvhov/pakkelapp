import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical } from 'lucide-react';
import { calm } from '../motion';
import { errorText, haptic, type Person } from '../lib';
import { Avatar, Segmented, Switch, useToast } from '../ui';

type SortItem = { id: string; name: string; person?: Person };

/** CSS held rada under fingeren på plass medan ein dreg. */
export function SortList({ items, onSave, onClose, arrows = false, visibility }: {
  items: SortItem[]; onSave: (order: string[]) => void | Promise<void>; onClose: () => void; arrows?: boolean;
  visibility?: { hidden: string[]; toggle: (id: string, show: boolean) => void };
}) {
  const toast = useToast();
  const [order, setOrder] = useState(() => items.map((item) => item.id));
  const dragOrder = useRef(order);
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
    dragOrder.current = order;
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
      await onSave(order);
      onClose();
    } catch (err) {
      toast(errorText(err, 'Kunne ikkje lagre rekkefølgja.'));
      setSaving(false);
    }
  };

  return (
    <>
      <ul className="pr-list sort-list" ref={list}>
        {(dragging ? dragOrder.current : order).map((id) => {
          const item = items.find((entry) => entry.id === id);
          if (!item) return null;
          const index = order.indexOf(id);
          return (
            <li key={id} data-person={id} className={`sort-row ${dragging === id ? 'dragging' : ''}`} style={{ order: index }}>
              {visibility ? (
                <Switch label={item.name} checked={!visibility.hidden.includes(id)} onChange={(show) => visibility.toggle(id, show)} />
              ) : <>
              {item.person && <Avatar person={item.person} size={36} />}
              <strong>{item.name}</strong>
              {arrows && <>
                <button type="button" className="order-arrow" aria-label={`Flytt ${item.name} opp`} disabled={index === 0} onClick={() => move(id, index - 1)}><ArrowUp size={17} /></button>
                <button type="button" className="order-arrow" aria-label={`Flytt ${item.name} ned`} disabled={index === order.length - 1} onClick={() => move(id, index + 1)}><ArrowDown size={17} /></button>
              </>}
              <button
                type="button" className="grip" aria-label={`Dra ${item.name}, plass ${index + 1} av ${order.length}. Bruk pil opp og ned.`}
                onPointerDown={(e) => { if (e.isPrimary && e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); grab(id, e.clientY); } }}
                onPointerMove={(e) => { if (e.isPrimary && dragging === id) dragTo(id, e.clientY); }}
                onPointerUp={drop} onPointerCancel={drop}
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
                  if (step) { e.preventDefault(); move(id, index + step); }
                }}
              ><GripVertical size={20} /></button>
              </>}
            </li>
          );
        })}
      </ul>
      <div className="sort-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>Avbryt</button>
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving}>{saving ? 'Lagrar …' : arrows ? 'Lagre' : 'Lagre rekkefølgja'}</button>
      </div>
    </>
  );
}

type HomeSection = { id: string; name: string; content: ReactNode };
type HomePreferences = { order: string[]; hidden: string[] };

function readHomePreferences(key: string): HomePreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
    const hidden = Array.isArray(saved?.hidden) ? strings(saved.hidden) : [
      ...(saved?.hideCosts === true ? ['budget'] : []),
      ...(localStorage.getItem('starter-hidden') === '1' ? ['starter'] : []),
    ];
    return { order: strings(saved?.order), hidden };
  } catch { /* Standardrekkefølgja fungerer også utan lokal lagring. */ }
  return { order: [], hidden: [] };
}

export function MobileOverview({ userId, sections, notice }: { userId: string; sections: HomeSection[]; notice: ReactNode }) {
  const key = `mobile-home:${userId}`;
  const [preferences, setPreferences] = useState(() => readHomePreferences(key));
  const [editing, setEditing] = useState(false);
  const [hidden, setHidden] = useState(preferences.hidden);
  const [mode, setMode] = useState<'visibility' | 'order'>('visibility');
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const toast = useToast();
  const ids = sections.map((section) => section.id);
  const order = [...new Set([...preferences.order.filter((id) => ids.includes(id)), ...ids])];
  const sorted = [...sections].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const visible = sorted.filter((section) => section.content && !preferences.hidden.includes(section.id));
  const finish = () => {
    setEditing(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const save = (newOrder: string[]) => {
    const next = { order: newOrder, hidden };
    localStorage.setItem(key, JSON.stringify(next));
    setPreferences(next);
    toast('Oversikta er lagra');
  };
  if (editing) return (
    <div className="page home-customize">
      <h1 tabIndex={-1} ref={title}>Tilpass oversikta</h1>
      <Segmented label="Tilpassing" value={mode} onChange={setMode} options={[{ id: 'visibility', label: 'Vis modular' }, { id: 'order', label: 'Flytt modular' }]} />
      {mode === 'visibility' ? (
        <>
          <p className="muted">Vel det du vil sjå på denne eininga. Ei tom gåveliste kjem fram når ho får innhald.</p>
          <div className="home-bulk">
            <button type="button" disabled={ids.every((id) => !hidden.includes(id))} onClick={() => setHidden([])}>Vis alle</button>
            <button type="button" disabled={ids.every((id) => hidden.includes(id))} onClick={() => setHidden(ids)}>Skjul alle</button>
          </div>
        </>
      ) : <p className="muted">Dra i handtaket eller bruk pilene.</p>}
      <SortList items={sorted} onSave={save} onClose={finish} arrows visibility={mode === 'visibility' ? {
        hidden, toggle: (id, show) => setHidden((current) => show ? current.filter((value) => value !== id) : [...current, id]),
      } : undefined} />
    </div>
  );
  return (
    <div className="page home home-mobile">
      <div className="home-toolbar"><span>Oversikt</span><button type="button" ref={trigger} onClick={() => {
        setHidden(preferences.hidden);
        setMode('visibility');
        setEditing(true);
        requestAnimationFrame(() => title.current?.focus());
      }}><ArrowUpDown size={15} /> Tilpass</button></div>
      {notice}
      {visible.map((section) => <Fragment key={section.id}>{section.content}</Fragment>)}
      {visible.length === 0 && <p className="home-empty">Oversikta di er tom. Under «Tilpass» kan du velje kva du vil sjå.</p>}
    </div>
  );
}
