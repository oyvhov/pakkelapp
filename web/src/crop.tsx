import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Sheet } from './ui';

/* Beskjering av profilbilete. useCrop()(fil) opnar eit ark og gjev ei kvadratisk fil, eller null om nokon avbryt. */

const OUT = 640;
const MAX_ZOOM = 4;

type Job = { file: File; resolve: (f: File | null) => void };
const CropContext = createContext<(file: File) => Promise<File | null>>(async (f) => f);
export const useCrop = () => useContext(CropContext);

export function CropProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<Job | null>(null);
  const [open, setOpen] = useState(false);
  const crop = useCallback((file: File) => new Promise<File | null>((resolve) => { setJob({ file, resolve }); setOpen(true); }), []);
  const finish = (f: File | null) => { job?.resolve(f); setOpen(false); };
  return (
    <CropContext.Provider value={crop}>
      {children}
      <Sheet open={open} onClose={() => finish(null)} title="Tilpass biletet">
        {job && <Cropper key={job.file.name + job.file.lastModified} file={job.file} onDone={finish} />}
      </Sheet>
    </CropContext.Provider>
  );
}

function Cropper({ file, onDone }: { file: File; onDone: (f: File | null) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState(280);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let made: ImageBitmap | null = null;
    createImageBitmap(file, { imageOrientation: 'from-image' })
      .then(async (b) => {
        made = b;
        if (!alive) return;
        // Teikn til ein canvas slik at førehandsvisinga og resultatet har same retning.
        const c = document.createElement('canvas');
        const k = Math.min(1, 1600 / Math.max(b.width, b.height));
        c.width = Math.round(b.width * k); c.height = Math.round(b.height * k);
        c.getContext('2d')!.drawImage(b, 0, 0, c.width, c.height);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
        if (!alive) return;
        setBitmap(b);
        setUrl(blob ? URL.createObjectURL(blob) : '');
      })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; made?.close(); };
  }, [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [bitmap]);

  const w = bitmap?.width ?? 1, h = bitmap?.height ?? 1;
  const scale = (size / Math.min(w, h)) * zoom;
  const clamp = (p: { x: number; y: number }, z = zoom) => {
    const s = (size / Math.min(w, h)) * z;
    const mx = Math.max(0, (w * s - size) / 2), my = Math.max(0, (h * s - size) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };
  const setZoomTo = (z: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    // Hald midten av utsnittet på same stad når ein zoomar.
    setPos((p) => clamp({ x: (p.x * next) / zoom, y: (p.y * next) / zoom }, next));
    setZoom(next);
  };

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoomTo(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist));
      return;
    }
    setPos((p) => clamp({ x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }));
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (d) { e.preventDefault(); setPos((p) => clamp({ x: p.x + d[0], y: p.y + d[1] })); }
    if (e.key === '+' || e.key === '=') setZoomTo(zoom + 0.2);
    if (e.key === '-') setZoomTo(zoom - 0.2);
  };

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); setZoomTo(zoom * Math.exp(-e.deltaY / 400)); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const save = async () => {
    if (!bitmap) return;
    setBusy(true);
    try {
      const side = size / scale;
      const sx = w / 2 - (size / 2 + pos.x) / scale;
      const sy = h / 2 - (size / 2 + pos.y) / scale;
      const out = Math.min(OUT, Math.round(side));
      const c = document.createElement('canvas');
      c.width = c.height = out;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88));
      onDone(blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file);
    } finally { setBusy(false); }
  };

  if (failed) return (
    <div className="cropper">
      <p className="muted">Kunne ikkje opne biletet for tilpassing. Du kan bruke det som det er.</p>
      <div className="form-actions"><button className="btn ghost" onClick={() => onDone(null)}>Avbryt</button><button className="btn gold" onClick={() => onDone(file)}>Bruk som det er</button></div>
    </div>
  );

  return (
    <div className="cropper">
      <div
        ref={frame}
        className={`crop-frame${url ? ' ready' : ''}`}
        tabIndex={0}
        role="application"
        aria-label="Biletutsnitt. Dra for å flytte, klyp eller bruk glidaren for å zoome. Piltastar flyttar."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onKeyDown={key}
      >
        {url && (
          <img
            src={url} alt="" draggable={false}
            style={{ width: w * scale, height: h * scale, transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)` }}
          />
        )}
        <span className="crop-ring" aria-hidden="true" />
      </div>
      <label className="crop-zoom">
        <ZoomOut size={18} aria-hidden="true" />
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => setZoomTo(Number(e.target.value))} aria-label="Zoom" disabled={!url} />
        <ZoomIn size={18} aria-hidden="true" />
      </label>
      <p className="muted crop-hint">Dra biletet for å flytte det. Klyp eller bruk glidaren for å zoome.</p>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={() => onDone(null)}>Avbryt</button>
        <button type="button" className="btn gold" onClick={() => void save()} disabled={!url || busy}>Bruk biletet</button>
      </div>
    </div>
  );
}
