import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, ExternalLink, Heart, Loader2 } from 'lucide-react';
import { errorText, kr, pb, PRIORITIES } from '../lib';
import { Empty, FadeImg, Field, GiftImage, Logo, Sheet, useToast } from '../ui';
import { Garland } from '../decor';
import type { Gift } from '../lib';

interface SharedGift { id: string; title: string; url: string; shop: string; note: string; price: number; priority: number; image: string; taken: boolean }
interface SharedList { name: string; person: string; own: boolean; gifts: SharedGift[] }

const MINE_KEY = 'guest-claims';
const NAME_KEY = 'guest-name';

function readMine(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(MINE_KEY) ?? '{}') as Record<string, string>; } catch { return {}; }
}
function readName() {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* lagring er ikkje tilgjengeleg */ }
}

/** Offentleg side for dei som har fått ei deleleink, utan konto. */
export function SharedPage({ token }: { token: string }) {
  const toast = useToast();
  const [list, setList] = useState<SharedList | null>(null);
  const [failed, setFailed] = useState(false);
  const [mine, setMine] = useState(readMine);
  const [name, setName] = useState(readName);
  const [asking, setAsking] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => pb.send<SharedList>(`/api/jul/shared/${encodeURIComponent(token)}`, {}).then(setList).catch(() => setFailed(true)), [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (list) document.title = `Ønska til ${list.person}`; }, [list]);

  const remember = (next: Record<string, string>) => {
    setMine(next);
    store(MINE_KEY, JSON.stringify(next));
  };

  const claim = async (giftId: string, who: string) => {
    setBusy(giftId);
    try {
      const res = await pb.send<{ claimToken: string }>(`/api/jul/shared/${encodeURIComponent(token)}/claim`, { method: 'POST', body: { giftId, name: who } });
      remember({ ...mine, [giftId]: res.claimToken });
      toast('Fint! Den er din.');
    } catch (err) {
      toast(errorText(err, 'Kunne ikkje reservere ønsket.'));
    } finally {
      await load();
      setBusy('');
    }
  };
  const unclaim = async (giftId: string) => {
    setBusy(giftId);
    try {
      await pb.send(`/api/jul/shared/${encodeURIComponent(token)}/unclaim`, { method: 'POST', body: { claimToken: mine[giftId] } });
      const next = { ...mine };
      delete next[giftId];
      remember(next);
    } catch (err) {
      toast(errorText(err, 'Kunne ikkje angre.'));
    } finally {
      await load();
      setBusy('');
    }
  };
  const take = (giftId: string) => {
    if (name.trim()) void claim(giftId, name.trim());
    else setAsking(giftId);
  };
  const submitName = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    store(NAME_KEY, clean);
    const giftId = asking;
    setAsking('');
    void claim(giftId, clean);
  };

  const brand = <div className="shared-brand"><Logo size={26} /><span>Pakke<i>lapp</i></span></div>;

  if (failed) {
    return <div className="shared">{brand}<Empty title="Denne lenka verkar ikkje lenger">Be den som delte lista om ei ny lenke.</Empty></div>;
  }
  if (!list) return <div className="shared" aria-busy="true">{brand}<div className="shared-loading"><Loader2 className="spin" size={26} /></div></div>;

  const gifts = [...list.gifts].sort((a, b) => Number(a.taken) - Number(b.taken) || b.priority - a.priority);
  return (
    <div className="shared">
      <header className="shared-hero">
        <div className="snow" aria-hidden="true" />
        <Garland />
        {brand}
        <p className="eyebrow">{list.name}</p>
        <h1>Ønska til {list.person}</h1>
        <p className="shared-lead">{list.own ? 'Slik ser lista ut for dei du deler ho med. Du ser ikkje kva som er teke.' : `Trykk «Eg tek denne» på det du vil gje, så slepp andre å kjøpe det same. ${list.person} ser ikkje kven som har teke kva.`}</p>
      </header>

      {gifts.length === 0 ? <Empty title="Lista er tom enno" /> : (
        <ul className="shared-grid">
          {gifts.map((g) => {
            const isMine = !!mine[g.id] && g.taken;
            return (
              <li key={g.id} className={`shared-card ${g.taken && !isMine ? 'taken' : ''}`}>
                <span className="shared-media">
                  {g.image ? <FadeImg src={g.image} /> : <GiftImage gift={{ id: g.id, image: '' } as Gift} />}
                  {g.priority === 2 && <span className="gift-heart" title={PRIORITIES[2]}><Heart size={14} fill="currentColor" /></span>}
                </span>
                <div className="shared-body">
                  <h2>{g.title}</h2>
                  <p className="shared-meta">{g.price > 0 && <strong>{kr(g.price)}</strong>}{g.shop && <span>{g.shop}</span>}</p>
                  {g.note && <p className="shared-note">{g.note}</p>}
                  <div className="shared-actions">
                    {/^https?:\/\//i.test(g.url) && <a className="btn small ghost" href={g.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={15} /> Sjå</a>}
                    {!list.own && (isMine ? (
                      <>
                        <span className="pill pill-bought"><Check size={13} /> Du tek denne</span>
                        <button type="button" className="btn small ghost" disabled={busy === g.id} onClick={() => void unclaim(g.id)}>Angre</button>
                      </>
                    ) : g.taken ? <span className="pill pill-taken">Teken</span> : (
                      <button type="button" className="btn small primary" disabled={busy === g.id} onClick={() => take(g.id)}>{busy === g.id ? 'Lagrar …' : 'Eg tek denne'}</button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!asking} onClose={() => setAsking('')} title="Kven er du?">
        <form className="form" onSubmit={submitName}>
          <Field label="Namnet ditt" hint="Slik at familien veit kven som har teke ønsket.">
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus autoComplete="name" />
          </Field>
          <div className="form-actions"><button className="btn primary">Eg tek denne</button></div>
        </form>
      </Sheet>
    </div>
  );
}
