import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Archive, Check, Plus, Trash2 } from 'lucide-react';
import { useData } from '../data';
import { errorText, haptic, pb } from '../lib';
import { Empty, Field, Skeleton, useConfirm, useToast } from '../ui';

interface Item { key: string; recordId: string; title: string; from: string; thanked: boolean; wish: boolean }
interface Received { open: boolean; year: number; items: Item[] }

export function ThanksPage() {
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [state, setState] = useState<Received | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('');

  const load = useCallback(() => {
    setFailed(false);
    return pb.send<Received>('/api/jul/received', {}).then(setState).catch(() => setFailed(true));
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (failed) return <div className="page"><Empty title="Fekk ikkje henta lista" action={<button className="btn primary" onClick={() => void load()}>Prøv igjen</button>} /></div>;
  if (!state) return <Skeleton />;

  const back = <Link className="back" to="/"><ArrowLeft size={18} /> Oversikt</Link>;
  if (!state.open) {
    return (
      <div className="page narrow">
        {back}
        <header className="page-head"><h1>Takkelista</h1></header>
        <Empty title="Opnar klokka 18 på julaften">Då ser du kven som gav deg kva, og kan krysse av etter kvart som du har takka.</Empty>
      </div>
    );
  }

  const setItem = (match: Item, change: Partial<Item>) => setState((s) => (s ? { ...s, items: s.items.map((i) => (i === match ? { ...i, ...change } : i)) } : s));
  const toggle = async (item: Item) => {
    haptic();
    const thanked = !item.thanked;
    setItem(item, { thanked });
    try {
      if (item.recordId) await pb.collection('received').update(item.recordId, { thanked });
      else await pb.collection('received').create({ user: data.me.id, year: state.year, key: item.key, title: item.title.slice(0, 200), from_names: item.from.slice(0, 200), thanked });
    } catch (err) { toast(errorText(err)); }
    await load();
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await pb.collection('received').create({ user: data.me.id, year: state.year, key: '', title: title.trim(), from_names: from.trim(), thanked: false });
      setTitle('');
      setFrom('');
      await load();
    } catch (err) { toast(errorText(err)); }
  };
  const remove = async (item: Item) => {
    try {
      await pb.collection('received').delete(item.recordId);
      await load();
    } catch (err) { toast(errorText(err)); }
  };
  const tidy = async () => {
    if (!(await confirm({ title: 'Rydde ønskelista?', body: 'Ønska du har fått, blir flytta til arkivet. Du finn dei igjen på lista under Arkivert.', action: 'Rydd' }))) return;
    try {
      const res = await pb.send<{ archived: number }>('/api/jul/received/archive', { method: 'POST' });
      await data.reload('gifts');
      toast(res.archived ? `${res.archived} ${res.archived === 1 ? 'ønske' : 'ønske'} flytta til arkivet` : 'Det var ingenting å rydde');
    } catch (err) { toast(errorText(err)); }
  };

  const done = state.items.filter((i) => i.thanked).length;
  const sorted = [...state.items].sort((a, b) => Number(a.thanked) - Number(b.thanked));
  return (
    <div className="page narrow">
      {back}
      <header className="page-head">
        <div>
          <h1>Takkelista</h1>
          {state.items.length > 0 && <p className="muted">{done} av {state.items.length} er takka for</p>}
        </div>
      </header>

      {sorted.length === 0
        ? <Empty title="Ingenting her enno">Fekk du noko som ikkje var registrert i appen? Legg det til her.</Empty>
        : (
          <ul className="thanks">
            {sorted.map((item) => (
              <li key={item.key || item.recordId} className={item.thanked ? 'done' : ''}>
                <button type="button" role="checkbox" aria-checked={item.thanked} className="thanks-check" onClick={() => void toggle(item)} aria-label={`Takka for ${item.title}`}>
                  <i>{item.thanked && <Check size={14} strokeWidth={3} />}</i>
                </button>
                <span className="thanks-text"><strong>{item.title}</strong><small>Frå {item.from || 'ukjend'}</small></span>
                {!item.key && <button type="button" className="icon-btn small" onClick={() => void remove(item)} aria-label={`Fjern ${item.title}`}><Trash2 size={15} /></button>}
              </li>
            ))}
          </ul>
        )}

      <section className="panel">
        <h2>Legg til ei gåve</h2>
        <form className="form" onSubmit={add}>
          <div className="row-2">
            <Field label="Kva fekk du?"><input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></Field>
            <Field label="Frå kven?"><input value={from} onChange={(e) => setFrom(e.target.value)} maxLength={200} /></Field>
          </div>
          <div className="form-actions"><button className="btn ghost"><Plus size={16} /> Legg til</button></div>
        </form>
      </section>

      <button type="button" className="btn ghost full" onClick={() => void tidy()}><Archive size={16} /> Rydd ønskelista</button>
    </div>
  );
}
