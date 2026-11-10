import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Rørsle er pynt. Den som har bede om ro, får ro. */
export const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const EASE = 'cubic-bezier(.22, .9, .24, 1)';

/** Eit tal som tel seg fram til verdien i staden for å hoppe. */
export function Count({ value, format = String }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(() => (calm() ? value : 0));
  const current = useRef(shown);
  useEffect(() => {
    const from = current.current;
    const finish = () => { current.current = value; setShown(value); };
    if (from === value || calm()) { finish(); return; }
    const started = performance.now();
    const duration = 620;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const next = Math.round(from + (value - from) * (1 - (1 - t) ** 4));
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Ei fane i bakgrunnen får ikkje bilete, men skal likevel ende på rett tal.
    const safety = window.setTimeout(finish, duration + 300);
    return () => { cancelAnimationFrame(frame); clearTimeout(safety); };
  }, [value]);
  return <span className="count-num">{format(shown)}</span>;
}

const tops = (parent: HTMLElement) => {
  const map = new Map<string, number>();
  for (const child of Array.from(parent.children) as HTMLElement[]) {
    if (child.dataset.flip) map.set(child.dataset.flip, child.offsetTop);
  }
  return map;
};

/** Når rekkefølgja endrar seg, glir radene til den nye plassen sin. Borna må ha data-flip. */
export function useFlip(ref: RefObject<HTMLElement | null>, order: string) {
  const lastOrder = useRef(order);
  const before = useRef<Map<string, number> | null>(null);
  // Måler rett før React flyttar radene, så utgangspunktet er det auga faktisk såg.
  if (lastOrder.current !== order) {
    lastOrder.current = order;
    if (ref.current) before.current = tops(ref.current);
  }
  useLayoutEffect(() => {
    const parent = ref.current;
    const old = before.current;
    before.current = null;
    if (!parent || !old || calm()) return;
    const now = tops(parent);
    let far: HTMLElement | null = null;
    let farDelta = 0;
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      const id = child.dataset.flip;
      const was = id ? old.get(id) : undefined;
      if (!id || was === undefined) continue;
      const delta = was - (now.get(id) ?? was);
      if (!delta) continue;
      if (Math.abs(delta) > Math.abs(farDelta)) { far = child; farDelta = delta; }
      child.animate([{ translate: `0 ${delta}px` }, { translate: '0 0' }], { duration: 460, easing: EASE });
    }
    if (far) {
      const lifted = far;
      lifted.classList.add('flip-lift');
      window.setTimeout(() => lifted.classList.remove('flip-lift'), 480);
    }
  }, [ref, order]);
}

/** Eit lite trykk-svar på eitt element. */
export function pop(el: Element | null) {
  if (!el || calm() || typeof el.animate !== 'function') return;
  el.animate([{ scale: '1' }, { scale: '1.14', offset: 0.35 }, { scale: '1' }], { duration: 360, easing: EASE });
}

const CONFETTI = ['#e9b949', '#e0566e', '#7fe0b6', '#fbf3e0', '#b88a35'];

/** Ein liten dryss med konfetti ut frå eit element. Rydd opp etter seg sjølv. */
export function celebrate(el: Element | null) {
  if (!el || calm()) return;
  const rect = el.getBoundingClientRect();
  const host = document.createElement('div');
  host.className = 'confetti';
  host.setAttribute('aria-hidden', 'true');
  host.style.left = `${rect.left + rect.width / 2}px`;
  host.style.top = `${rect.top + rect.height / 2}px`;
  const count = 16;
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('i');
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const reach = 38 + Math.random() * 46;
    bit.style.setProperty('--dx', `${Math.cos(angle) * reach}px`);
    bit.style.setProperty('--dy', `${Math.sin(angle) * reach - 22}px`);
    bit.style.setProperty('--turn', `${Math.round(Math.random() * 540 - 270)}deg`);
    bit.style.background = CONFETTI[i % CONFETTI.length];
    if (i % 3 === 0) bit.style.borderRadius = '50%';
    host.append(bit);
  }
  document.body.append(host);
  window.setTimeout(() => host.remove(), 1000);
}

/** På skjermar med mus bøyer gåvekorta seg lett mot peikaren, og lyset i toppkortet fylgjer med. */
export function initPointerLife() {
  if (typeof matchMedia !== 'function' || !matchMedia('(hover: hover) and (pointer: fine)').matches || calm()) return;
  let card: HTMLElement | null = null;
  let frame = 0;
  let last: PointerEvent | null = null;
  const release = () => {
    if (!card) return;
    for (const name of ['--rx', '--ry', '--gx', '--gy']) card.style.removeProperty(name);
    card = null;
  };
  const apply = () => {
    frame = 0;
    const e = last;
    if (!e || !(e.target instanceof Element)) return;
    const next = e.target.closest<HTMLElement>('.gift');
    if (card && card !== next) release();
    if (next) {
      const r = next.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      next.style.setProperty('--ry', `${((x - 0.5) * 6).toFixed(2)}deg`);
      next.style.setProperty('--rx', `${((0.5 - y) * 6).toFixed(2)}deg`);
      next.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
      next.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
      card = next;
    }
    const hero = e.target.closest<HTMLElement>('.hero');
    if (hero) {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      hero.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    }
  };
  document.addEventListener('pointermove', (e) => {
    last = e;
    if (!frame) frame = requestAnimationFrame(apply);
  }, { passive: true });
  document.addEventListener('pointerleave', release);
}
