import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Home, ListChecks, Plus, Settings, Sparkles, Users, Wallet } from 'lucide-react';
import { DataProvider, isRecipient, newWishCount, useAuth, useData, useSeen } from './data';
import { GiftProvider, useGifts } from './gifts';
import { CropProvider } from './crop';
import { Avatar, ConfirmProvider, LoadError, Logo, Skeleton, ToastProvider } from './ui';
import { isHttpUrl } from './lib';
import { Forest, Hills } from './decor';
import { JoinPage, LoginPage, ResetPage } from './pages/Auth';
import { HomePage } from './pages/Home';
import { PeoplePage, PersonPage } from './pages/People';
import { ListPage, ListsPage } from './pages/Lists';
import { NissenPage } from './pages/Nissen';
import { SettlePage } from './pages/Settle';
import { SettingsPage } from './pages/Settings';
import { AdminPage } from './pages/Admin';
import { SharedPage } from './pages/Shared';
import { ThanksPage } from './pages/Thanks';

export function applyTheme(theme: string) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

const RAIL = [
  { to: '/', label: 'Oversikt', icon: Home, end: true },
  { to: '/folk', label: 'Folk', icon: Users },
  { to: '/lister', label: 'Lister', icon: ListChecks },
  { to: '/oppgjer', label: 'Oppgjer', icon: Wallet },
  { to: '/nissen', label: 'Nissen', icon: Sparkles },
  { to: '/meg', label: 'Innstillingar', icon: Settings },
];
const LEFT_TABS = [RAIL[0], RAIL[1]];
const RIGHT_TABS = [RAIL[2], RAIL[3]];
const ROOTS = RAIL.map((r) => r.to);
const rootOf = (path: string) => `/${path.split('/')[1] ?? ''}`;

/** Kvar den nye sida ligg i høve til den gamle, så ho kan kome inn frå rett kant. */
function directionOf(from: string, to: string) {
  const a = rootOf(from);
  const b = rootOf(to);
  if (a === b) return to.length >= from.length ? 'in' : 'out';
  // Frå Oversikt inn på ein person og attende er djupn, ikkje eit fanebyte.
  const deep = (path: string) => path.split('/').filter(Boolean).length > 1;
  if (from === '/' && deep(to)) return 'in';
  if (to === '/' && deep(from)) return 'out';
  const i = ROOTS.indexOf(a);
  const j = ROOTS.indexOf(b);
  if (i < 0 || j < 0) return 'up';
  return j > i ? 'right' : 'left';
}

/** Innhaldet kjem inn i tur og orden berre rett etter eit sidebyte, ikkje kvar gong ei liste endrar seg. */
function RouteFrame({ dir, children }: { dir: string; children: ReactNode }) {
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setFresh(false), 1100);
    return () => clearTimeout(timer);
  }, []);
  return <div className={`route ${fresh ? 'fresh' : ''}`} data-dir={dir}>{children}</div>;
}

function ShareTarget() {
  const [params] = useSearchParams();
  const { addGift } = useGifts();
  const navigate = useNavigate();
  useEffect(() => {
    const candidates = [params.get('url'), params.get('text')?.match(/https?:\/\/\S+/)?.[0]];
    const url = candidates.find((c) => c && isHttpUrl(c)) ?? '';
    addGift({ url, title: url ? '' : params.get('title') ?? params.get('text') ?? '' });
    navigate('/', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function SharedRoute() {
  const { token = '' } = useParams();
  return <SharedPage token={token} />;
}

/** Etter innlogging skal ein tilbake dit ein var på veg. */
function AfterLogin() {
  const location = useLocation();
  return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;
}

function Shell({ children }: { children: ReactNode }) {
  const { addGift } = useGifts();
  const data = useData();
  const seen = useSeen();
  const location = useLocation();
  const navigationType = useNavigationType();
  const hasNew = data.people.some((p) => p.user !== data.me.id && isRecipient(data, p.id) && newWishCount(data, seen, p.id) > 0);
  const pending = data.settlements.filter((s) => s.status === 'pending' && s.receivers.includes(data.me.id)).length
    + data.people.filter((p) => p.covered_request && p.covered_request_by !== data.me.id && (p.user === data.me.id || data.peopleById.get(p.covered_request)?.user === data.me.id)).length;
  // Med tilbake-knappen skal ein kome attende til same stad på sida.
  useEffect(() => { if (navigationType !== 'POP') window.scrollTo({ top: 0 }); }, [location.pathname, navigationType]);
  const [nav, setNav] = useState({ path: location.pathname, dir: 'up' });
  if (nav.path !== location.pathname) setNav({ path: location.pathname, dir: directionOf(nav.path, location.pathname) });
  const root = rootOf(location.pathname);
  const railIndex = ROOTS.indexOf(root);
  const tabIndex = [LEFT_TABS[0].to, LEFT_TABS[1].to, '', RIGHT_TABS[0].to, RIGHT_TABS[1].to].indexOf(root);
  const [railSmall, setRailSmall] = useState(() => { try { return localStorage.getItem('rail-small') === '1'; } catch { return false; } });
  const toggleRail = () => {
    setRailSmall(!railSmall);
    try { localStorage.setItem('rail-small', railSmall ? '0' : '1'); } catch { /* lagring er ikkje tilgjengeleg */ }
  };

  return (
    <div className={`shell ${railSmall ? 'rail-small' : ''}`}>
      <aside className="rail">
        {data.fest ? <Hills /> : <Forest />}
        <button type="button" className="rail-toggle" onClick={toggleRail} aria-expanded={!railSmall} aria-label={railSmall ? 'Vis heile sidemenyen' : 'Gjer sidemenyen mindre'}><ChevronLeft size={16} /></button>
        <div className="brand"><Logo size={34} /><span>Pakke<i>lapp</i></span></div>
        {data.config.familyName && <p className="rail-family">{data.config.familyName}</p>}
        <nav aria-label="Hovudmeny">
          {railIndex >= 0 && <i className="rail-glow" aria-hidden="true" style={{ '--i': railIndex } as CSSProperties} />}
          {RAIL.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} title={railSmall ? label : undefined}><Icon size={20} /> <span>{label}</span>{to === '/oppgjer' && pending > 0 && <b className="count">{pending}</b>}{to === '/folk' && hasNew && <b className="rail-new" aria-label="Nye ønske" />}</NavLink>
          ))}
        </nav>
        <button className="btn gold full" title={railSmall ? 'Ny gåve' : undefined} onClick={() => addGift()}><Plus size={18} /> <span>Ny gåve</span></button>
      </aside>

      <header className="topbar">
        <Link to="/" className="brand small"><Logo size={26} /><span>Pakke<i>lapp</i></span></Link>
        <div className="topbar-actions">
          {data.config.aiEnabled && <Link to="/nissen" className="nisse-chip"><Sparkles size={16} /> Nissen</Link>}
          <Link to="/meg" aria-label="Innstillingar"><Avatar person={data.myPerson} size={34} /></Link>
        </div>
      </header>

      <main className="main">
        {data.ready ? <RouteFrame key={location.pathname} dir={nav.dir}>{children}</RouteFrame> : data.loadFailed ? <LoadError onRetry={data.retry} /> : <Skeleton />}
      </main>

      <nav className="tabbar" aria-label="Hovudmeny">
        {tabIndex >= 0 && <i className="tab-glow" aria-hidden="true" style={{ '--i': tabIndex } as CSSProperties} />}
        {LEFT_TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}><span className="tab-icon"><Icon size={22} />{to === '/folk' && hasNew && <b className="dot" aria-label="Nye ønske" />}</span><span>{label}</span></NavLink>
        ))}
        <button className="fab" onClick={() => addGift()} aria-label="Ny gåve"><Plus size={26} /></button>
        {RIGHT_TABS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}><span className="tab-icon"><Icon size={22} />{to === '/oppgjer' && pending > 0 && <b className="dot" />}</span><span>{label}</span></NavLink>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  const auth = useAuth();
  const location = useLocation();
  useEffect(() => {
    try { applyTheme(localStorage.getItem('theme') ?? 'auto'); } catch { /* lagring er ikkje tilgjengeleg */ }
  }, []);

  return (
    <ToastProvider>
      <ConfirmProvider>
        <CropProvider>
        <Routes>
          <Route path="/bli-med/:code" element={<JoinPage />} />
          <Route path="/nytt-passord/:token" element={<ResetPage />} />
          <Route path="/delt/:token" element={<SharedRoute />} />
          {!auth ? (
            <>
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
            </>
          ) : (
            <Route
              path="*"
              element={
                <DataProvider me={auth}>
                  <GiftProvider>
                    <Shell>
                      <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/folk" element={<PeoplePage />} />
                        <Route path="/folk/:id" element={<PersonPage />} />
                        <Route path="/lister" element={<ListsPage />} />
                        <Route path="/lister/:id" element={<ListPage />} />
                        <Route path="/oppgjer" element={<SettlePage />} />
                        <Route path="/nissen" element={<NissenPage />} />
                        <Route path="/meg" element={<SettingsPage />} />
                        <Route path="/admin" element={<AdminPage />} />
                        <Route path="/takk" element={<ThanksPage />} />
                        <Route path="/del" element={<ShareTarget />} />
                        <Route path="/login" element={<AfterLogin />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </Shell>
                  </GiftProvider>
                </DataProvider>
              }
            />
          )}
        </Routes>
        </CropProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
