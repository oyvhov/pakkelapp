/** Julepynt som SVG: lysslynge, grein, adventslys, skog og sløyfe. */

const WIRE_SEGMENTS = 6;
const SEGMENT = 110;
const TOP = 3;
const SAG = 26;

export function Garland() {
  const wire = `M0 ${TOP}` + Array.from({ length: WIRE_SEGMENTS }, (_, i) => ` Q${SEGMENT * (i + 0.5)} ${SAG} ${SEGMENT * (i + 1)} ${TOP}`).join('');
  const bulbs = Array.from({ length: WIRE_SEGMENTS }, (_, i) => [0.22, 0.5, 0.78].map((t) => ({
    x: SEGMENT * (i + t),
    y: (1 - t) ** 2 * TOP + 2 * (1 - t) * t * SAG + t ** 2 * TOP,
  }))).flat();
  return (
    <svg className="garland" viewBox={`0 0 ${SEGMENT * WIRE_SEGMENTS} 34`} preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <path d={wire} fill="none" stroke="rgba(248,241,226,.4)" strokeWidth="1.2" />
      {bulbs.map((b, i) => (
        <g key={i} transform={`translate(${b.x} ${b.y})`}>
          <rect x="-1.6" y="0" width="3.2" height="3" rx=".6" fill="rgba(248,241,226,.7)" />
          <ellipse className={`bulb bulb-${i % 3}`} style={{ animationDelay: `${(i * 0.37) % 2.4}s` }} cx="0" cy="7.4" rx="3.6" ry="4.8" />
        </g>
      ))}
    </svg>
  );
}

export function PineBranch() {
  const points = Array.from({ length: 15 }, (_, i) => {
    const t = i / 14;
    return { x: 236 - 200 * t, y: 6 + 44 * t * t + 6 * t, len: 26 - 12 * t };
  });
  return (
    <svg className="pine-branch" viewBox="0 0 240 118" aria-hidden="true">
      <path d="M240 4 Q130 12 34 58" fill="none" stroke="#5b3d24" strokeWidth="3" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i} stroke={i % 2 ? '#3d7565' : '#2f6052'} strokeWidth="2.3" strokeLinecap="round">
          <line x1={p.x} y1={p.y} x2={p.x - p.len * 0.72} y2={p.y - p.len * 0.72} />
          <line x1={p.x} y1={p.y} x2={p.x - p.len} y2={p.y - p.len * 0.2} />
          <line x1={p.x} y1={p.y} x2={p.x - p.len * 0.8} y2={p.y + p.len * 0.62} />
          <line x1={p.x} y1={p.y} x2={p.x - p.len * 0.3} y2={p.y + p.len * 0.82} />
        </g>
      ))}
      <path d="M170 18 V54" stroke="#e2bd72" strokeWidth="1" />
      <circle cx="170" cy="64" r="11" fill="#a8233b" />
      <circle cx="166" cy="60" r="2.6" fill="rgba(255,255,255,.55)" />
      <path d="M104 32 V76" stroke="#e2bd72" strokeWidth="1" />
      <circle cx="104" cy="85" r="9" fill="#dcb468" />
      <circle cx="101" cy="82" r="2.1" fill="rgba(255,255,255,.65)" />
    </svg>
  );
}

export function AdventCandles({ lit }: { lit: number }) {
  const label = lit > 0 ? `${lit} av 4 adventslys er tende` : 'Adventslysa er ikkje tende enno';
  return (
    <svg className="candles" viewBox="0 0 92 56" role="img" aria-label={label}>
      <rect x="2" y="48" width="88" height="6" rx="3" fill="#b88a35" />
      {[0, 1, 2, 3].map((i) => {
        const x = 8 + i * 21;
        const on = i < lit;
        return (
          <g key={i}>
            <rect x={x} y="24" width="13" height="24" rx="2" fill="#fbf3e0" />
            <rect x={x} y="24" width="4" height="24" rx="2" fill="rgba(23,55,47,.1)" />
            <line x1={x + 6.5} y1="24" x2={x + 6.5} y2="19" stroke="#3a2a18" strokeWidth="1.3" />
            {on && <path className="flame" style={{ animationDelay: `${i * 0.4}s` }} d={`M${x + 6.5} 4 C${x + 11} 11 ${x + 10} 19 ${x + 6.5} 19 C${x + 3} 19 ${x + 2} 11 ${x + 6.5} 4Z`} fill="#f5c04e" />}
          </g>
        );
      })}
    </svg>
  );
}

const TREES = [[16, 54], [58, 74], [100, 58], [146, 86], [192, 62], [226, 78]];

export function Forest() {
  return (
    <svg className="forest" viewBox="0 0 240 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {TREES.map(([x, h]) => (
        <g key={x}>
          <path d={`M${x} ${120 - h} L${x + h * 0.36} ${120 - h * 0.48} H${x - h * 0.36} Z`} fill="#2f6455" />
          <path d={`M${x} ${120 - h * 0.74} L${x + h * 0.46} 120 H${x - h * 0.46} Z`} fill="#2f6455" />
          <path d={`M${x} ${120 - h} L${x + h * 0.14} ${120 - h * 0.8} L${x + 2} ${120 - h * 0.84} L${x - 3} ${120 - h * 0.78} L${x - h * 0.14} ${120 - h * 0.8} Z`} fill="#f8f1e2" />
        </g>
      ))}
      <path d="M0 112 Q60 104 120 112 T240 110 V120 H0 Z" fill="#f8f1e2" opacity=".9" />
    </svg>
  );
}

/* Feiringar resten av året: vimpelsnor, ballongar og mjuke åsar. */
const FLAGS = ['#f2a65a', '#e0566e', '#6fcfa6', '#f6d67a', '#8fb8ff'];

export function Bunting() {
  const wire = `M0 ${TOP}` + Array.from({ length: WIRE_SEGMENTS }, (_, i) => ` Q${SEGMENT * (i + 0.5)} ${SAG} ${SEGMENT * (i + 1)} ${TOP}`).join('');
  const flags = Array.from({ length: WIRE_SEGMENTS }, (_, i) => [0.14, 0.38, 0.62, 0.86].map((t) => ({
    x: SEGMENT * (i + t),
    y: (1 - t) ** 2 * TOP + 2 * (1 - t) * t * SAG + t ** 2 * TOP,
  }))).flat();
  return (
    <svg className="garland" viewBox={`0 0 ${SEGMENT * WIRE_SEGMENTS} 34`} preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <path d={wire} fill="none" stroke="rgba(248,241,226,.45)" strokeWidth="1.2" />
      {flags.map((f, i) => (
        <path key={i} className="flag" style={{ animationDelay: `${(i * 0.29) % 2.2}s`, transformOrigin: `${f.x}px ${f.y}px` }} d={`M${f.x - 6} ${f.y} H${f.x + 6} L${f.x} ${f.y + 13} Z`} fill={FLAGS[i % FLAGS.length]} />
      ))}
    </svg>
  );
}

export function Balloons() {
  const balloons = [{ x: 22, y: 20, c: '#e0566e' }, { x: 48, y: 14, c: '#f6d67a' }, { x: 73, y: 22, c: '#8fb8ff' }];
  return (
    <svg className="candles" viewBox="0 0 92 56" aria-hidden="true">
      {balloons.map((b, i) => (
        <g key={i} className="balloon" style={{ animationDelay: `${i * 0.7}s` }}>
          <path d={`M${b.x} ${b.y + 13} Q${b.x + 3} ${b.y + 26} ${b.x - 1} 56`} fill="none" stroke="rgba(248,241,226,.5)" strokeWidth="1" />
          <ellipse cx={b.x} cy={b.y} rx="10.5" ry="13" fill={b.c} />
          <path d={`M${b.x - 2.6} ${b.y + 15} H${b.x + 2.6} L${b.x} ${b.y + 12} Z`} fill={b.c} />
          <ellipse cx={b.x - 3.6} cy={b.y - 5} rx="2.4" ry="3.6" fill="rgba(255,255,255,.5)" />
        </g>
      ))}
    </svg>
  );
}

export function Hills() {
  return (
    <svg className="forest" viewBox="0 0 240 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <path d="M0 78 Q60 40 124 74 T240 60 V120 H0 Z" fill="rgba(255,255,255,.07)" />
      <path d="M0 100 Q70 68 140 96 T240 88 V120 H0 Z" fill="rgba(255,255,255,.1)" />
      {FLAGS.map((c, i) => <rect key={c} className="paper" x={30 + i * 44} y={22 + (i % 2) * 22} width="7" height="7" rx="1.4" fill={c} style={{ animationDelay: `${i * 0.6}s`, transformOrigin: `${33 + i * 44}px ${25 + (i % 2) * 22}px` }} />)}
    </svg>
  );
}

export function Bow() {
  return (
    <svg className="bow" viewBox="0 0 64 40" aria-hidden="true">
      <path d="M31 19 C20 2 2 2 4 14 C5 26 22 26 31 21 Z" fill="var(--ribbon)" />
      <path d="M33 19 C44 2 62 2 60 14 C59 26 42 26 33 21 Z" fill="var(--ribbon)" />
      <path d="M29 24 L19 39 L26 36 L31 26 Z M35 24 L45 39 L38 36 L33 26 Z" fill="var(--ribbon)" />
      <rect x="27" y="14" width="10" height="11" rx="3" fill="var(--ribbon)" />
      <rect x="27" y="14" width="10" height="11" rx="3" fill="rgba(0,0,0,.14)" />
    </svg>
  );
}
