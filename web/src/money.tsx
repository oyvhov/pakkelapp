import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { errorText, firstName, haptic, money, parseAmount, pb, today, type Expense, type Share } from './lib';
import { useData } from './data';
import { Avatar, Field, PersonPicker, personBusy, Segmented, Sheet, useConfirm, useToast, waitForPerson } from './ui';

export interface ExpenseDraft {
  giftId?: string;
  title?: string;
  amount?: number;
  payers?: string[];
  shares?: string[];
  kind?: 'expense' | 'refund';
  editing?: Expense;
}

type Mode = 'equal' | 'parts' | 'amounts';

export function expenseTitle(e: Expense, gifts: { id: string; title: string }[]) {
  if (e.gift) return gifts.find((g) => g.id === e.gift)?.title ?? 'Hemmeleg gåve';
  return e.title || 'Utlegg';
}

export function ExpenseSheet({ draft, onClose }: { draft: ExpenseDraft | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={!!draft} onClose={onClose} protect title={draft?.editing ? 'Endre utlegg' : draft?.kind === 'refund' ? 'Ny refusjon' : 'Nytt utlegg'}
      footer={<button className="btn primary full" type="submit" form="expense-form" disabled={busy}>{busy ? 'Lagrar …' : 'Lagre'}</button>}
    >
      {draft && <ExpenseForm key={draft.editing?.id ?? draft.giftId ?? 'ny'} draft={draft} onClose={onClose} onBusy={setBusy} />}
    </Sheet>
  );
}

function initialMode(e?: Expense): Mode {
  if (!e) return 'equal';
  if (e.shares.some((s) => s.fixed !== undefined && s.fixed !== null)) return 'amounts';
  return e.shares.every((s) => s.weight === 1) ? 'equal' : 'parts';
}

function ExpenseForm({ draft, onClose, onBusy }: { draft: ExpenseDraft; onClose: () => void; onBusy: (v: boolean) => void }) {
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const e = draft.editing;
  const giftId = e?.gift ?? draft.giftId ?? '';
  const gift = data.gifts.find((g) => g.id === giftId);
  const me = data.myPerson?.id;

  const [kind, setKind] = useState<'expense' | 'refund'>(e?.kind ?? draft.kind ?? 'expense');
  const [title, setTitle] = useState(e?.title ?? draft.title ?? '');
  const [amount, setAmount] = useState(e ? String(e.amount / 100) : draft.amount ? String(draft.amount) : '');
  const [payers, setPayers] = useState<string[]>(e?.payers.map((p) => p.person) ?? draft.payers ?? (me ? [me] : []));
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>(() => Object.fromEntries((e?.payers ?? []).map((p) => [p.person, String(p.ore / 100)])));
  const [shareIds, setShareIds] = useState<string[]>(e?.shares.map((s) => s.person) ?? (draft.shares?.length ? draft.shares : me ? [me] : []));
  const [mode, setMode] = useState<Mode>(initialMode(e));
  const [weights, setWeights] = useState<Record<string, string>>(() => Object.fromEntries((e?.shares ?? []).map((s) => [s.person, String(s.weight)])));
  const [fixed, setFixed] = useState<Record<string, string>>(() => Object.fromEntries((e?.shares ?? []).filter((s) => s.fixed !== undefined && s.fixed !== null).map((s) => [s.person, String(s.fixed! / 100)])));
  const [date, setDate] = useState(e?.spent_on ?? today());
  const [note, setNote] = useState(e?.note ?? '');
  const [more, setMore] = useState(!!e?.currency || !!e?.note);
  const [currency, setCurrency] = useState(e?.currency ?? '');
  const [original, setOriginal] = useState(e?.original_amount ? String(e.original_amount) : '');
  const [rate, setRate] = useState(e?.currency && e.original_amount ? String(e.amount / 100 / e.original_amount) : '');
  const [preview, setPreview] = useState<Record<string, number>>({});
  const [splitError, setSplitError] = useState('');
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const previewRun = useRef(0);
  const firstRender = useRef(true);
  useEffect(() => onBusy(saving), [saving, onBusy]);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (currency && parseAmount(original) > 0 && parseAmount(rate) > 0) setAmount((parseAmount(original) * parseAmount(rate)).toFixed(2));
  }, [currency, original, rate]);

  const ore = Math.round(parseAmount(amount) * 100);
  const shares: Share[] = useMemo(() => shareIds.map((person) => {
    if (mode === 'amounts' && fixed[person]?.trim()) return { person, weight: 1, fixed: Math.round(parseAmount(fixed[person]) * 100) };
    if (mode === 'parts') { const w = Number((weights[person] ?? '1').replace(',', '.')); return { person, weight: Number.isFinite(w) ? w : 0 }; }
    return { person, weight: 1 };
  }), [shareIds, mode, weights, fixed]);

  useEffect(() => {
    if (ore <= 0 || shares.length === 0) { setPreview({}); setSplitError(''); return; }
    const run = ++previewRun.current;
    const t = window.setTimeout(() => {
      pb.send<{ allocated?: Record<string, number>; error?: string }>('/api/jul/settle/preview', { method: 'POST', body: { amount: ore, shares } })
        .then((r) => { if (run === previewRun.current) { setPreview(r.allocated ?? {}); setSplitError(r.error ?? ''); } })
        .catch(() => undefined);
    }, 160);
    return () => window.clearTimeout(t);
  }, [ore, shares]);

  const paidSum = payers.length > 1 ? payers.reduce((s, p) => s + Math.round(parseAmount(payerAmounts[p] ?? '') * 100), 0) : ore;

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (saving) return;
    if (personBusy()) {
      await waitForPerson();
      window.setTimeout(() => formRef.current?.requestSubmit(), 40);
      return;
    }
    if (!giftId && !title.trim()) { toast('Skriv kva utlegget gjeld.'); return; }
    if (ore <= 0) { toast('Skriv inn eit beløp over null, til dømes 299 eller 1 299,50.'); return; }
    if (splitError) { toast(splitError); return; }
    if (payers.length === 0) { toast('Vel kven som betalte.'); return; }
    if (payers.length > 1 && paidSum !== ore) { toast(`Betalingane må bli ${money(ore)} til saman.`); return; }
    setSaving(true);
    try {
      const body = {
        title: giftId ? '' : title.trim(), note: note.trim(), kind, amount: ore, spent_on: date, gift: giftId,
        currency: more ? currency.trim().toUpperCase() : '', original_amount: more && currency ? parseAmount(original) : 0,
        payers: payers.map((person) => ({ person, ore: payers.length > 1 ? Math.round(parseAmount(payerAmounts[person] ?? '') * 100) : 0 })),
        shares,
      };
      if (e) await pb.collection('expenses').update(e.id, body);
      else await pb.collection('expenses').create({ ...body, created_by: data.me.id });
      await data.reload('expenses');
      haptic();
      toast('Lagra');
      onClose();
    } catch (err) {
      toast(errorText(err, 'Kunne ikkje lagre utlegget.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!e || !(await confirm({ title: 'Slette utlegget?', body: 'Skulda frå dette utlegget forsvinn for alle som er med.', action: 'Slett', danger: true }))) return;
    try {
      await pb.collection('expenses').delete(e.id);
      await data.reload('expenses');
      onClose();
    } catch (err) { toast(errorText(err)); }
  };

  return (
    <form ref={formRef} id="expense-form" className="form" onSubmit={save} aria-busy={saving}>
      <Segmented label="Type" value={kind} onChange={setKind} options={[{ id: 'expense', label: 'Utlegg' }, { id: 'refund', label: 'Pengar tilbake' }]} />
      {kind === 'refund' && <p className="field-hint">Bruk dette når noko er returnert eller blei billegare. Den som fekk pengane, skal gje dei vidare til dei som delte.</p>}

      {gift ? <p className="linked-gift">{gift.title}</p> : !giftId && <Field label="Kva gjeld det?"><input value={title} onChange={(ev) => setTitle(ev.target.value)} maxLength={200} placeholder="Gåvepapir, frakt, middag …" data-initial-focus={!e} /></Field>}

      <Field label="Beløp">
        <input className="amount-input" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="0 kr" />
      </Field>

      <PersonPicker label={kind === 'refund' ? 'Kven fekk pengane?' : 'Kven betalte?'} value={payers} onChange={setPayers} placeholder="Vel kven" />
      {payers.length > 1 && (
        <div className="split-rows">
          {payers.map((p) => (
            <label className="split-row" key={p}>
              <Avatar person={data.peopleById.get(p)} size={28} /><span>{firstName(data.peopleById.get(p)?.name)}</span>
              <input inputMode="decimal" value={payerAmounts[p] ?? ''} onChange={(ev) => setPayerAmounts((a) => ({ ...a, [p]: ev.target.value }))} placeholder="kr" aria-label={`Beløp betalt av ${data.peopleById.get(p)?.name}`} />
            </label>
          ))}
          <p className={`field-hint ${paidSum === ore ? '' : 'warn'}`}>{paidSum === ore ? 'Stemmer' : `Står att: ${money(ore - paidSum)}`}</p>
        </div>
      )}

      <PersonPicker label="Kven skal dele?" value={shareIds} onChange={setShareIds} placeholder="Vel kven som skal dele" />

      {shareIds.length > 0 && (
        <div className="field">
          <Segmented label="Delingsmåte" value={mode} onChange={setMode} options={[{ id: 'equal', label: 'Likt' }, { id: 'parts', label: 'I delar' }, { id: 'amounts', label: 'Faste beløp' }]} />
          <div className="split-rows">
            {shareIds.map((p) => {
              const isZero = mode === 'parts' && Number((weights[p] ?? '1').replace(',', '.')) === 0;
              return (
                <label className={`split-row ${isZero ? 'exempt' : ''}`} key={p}>
                  <Avatar person={data.peopleById.get(p)} size={28} /><span>{firstName(data.peopleById.get(p)?.name)}</span>
                  {mode === 'parts' && <input inputMode="decimal" value={weights[p] ?? '1'} onChange={(ev) => setWeights((w) => ({ ...w, [p]: ev.target.value }))} aria-label={`Delar for ${data.peopleById.get(p)?.name}`} />}
                  {mode === 'amounts' && <input inputMode="decimal" value={fixed[p] ?? ''} onChange={(ev) => setFixed((f) => ({ ...f, [p]: ev.target.value }))} placeholder="Resten" aria-label={`Fast beløp for ${data.peopleById.get(p)?.name}`} />}
                  <strong>{preview[p] !== undefined ? money(preview[p]) : '–'}</strong>
                </label>
              );
            })}
          </div>
          <p className={`field-hint ${splitError ? 'warn' : ''}`}>{splitError || (mode === 'parts' ? 'Vekt 2 betaler dobbelt så mykje som vekt 1. Vekt 0 slepp å betale.' : mode === 'amounts' ? 'Tomme felt deler det som står att.' : 'Appen fordeler øra, så summen alltid stemmer.')}</p>
        </div>
      )}

      <button type="button" className={`more ${more ? 'open' : ''}`} aria-expanded={more} onClick={() => setMore(!more)}><span>Dato, valuta og notat</span><ChevronDown size={17} /></button>
      <div className={`collapse ${more ? 'open' : ''}`}>
        <div className="collapse-inner form">
          <Field label="Dato"><input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /></Field>
          <div className="row-3">
            <Field label="Valuta"><input value={currency} onChange={(ev) => setCurrency(ev.target.value)} placeholder="EUR" maxLength={8} /></Field>
            <Field label="Beløp"><input inputMode="decimal" value={original} onChange={(ev) => setOriginal(ev.target.value)} /></Field>
            <Field label="Kurs"><input inputMode="decimal" value={rate} onChange={(ev) => setRate(ev.target.value)} placeholder="11,80" /></Field>
          </div>
          <Field label="Notat"><textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={1000} /></Field>
        </div>
      </div>
      {e && <button type="button" className="btn ghost danger full" onClick={() => void remove()}><Trash2 size={16} /> Slett utlegget</button>}
    </form>
  );
}
