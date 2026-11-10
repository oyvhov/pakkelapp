import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, ChevronDown, Copy, Flag, HeartHandshake, Plus, Sparkle } from 'lucide-react';
import { useData } from '../data';
import { useGifts } from '../gifts';
import { Garland } from '../decor';
import { expenseTitle } from '../money';
import { errorText, firstName, haptic, money, parseAmount, pb, type Expense, type Settlement, type Transfer } from '../lib';
import { Avatar, Empty, Field, LoadError, Segmented, Sheet, useConfirm, useToast } from '../ui';

const METHOD_LABEL: Record<string, string> = { vipps: 'Vipps', bank: 'Bank', cash: 'Kontant', other: 'Anna' };
type Mode = 'pay' | 'receive' | 'waive';

function SettleForm({ transfer, mode, onDone }: { transfer: Transfer; mode: Mode; onDone: () => void }) {
  const data = useData();
  const toast = useToast();
  const [amount, setAmount] = useState(String(transfer.ore / 100));
  const [method, setMethod] = useState<'vipps' | 'bank' | 'cash' | 'other'>('vipps');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const to = data.peopleById.get(transfer.to);
  const from = data.peopleById.get(transfer.from);
  const ore = Math.round(parseAmount(amount) * 100);
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); toast(label); } catch { toast(value); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (ore <= 0) { toast('Skriv inn eit beløp over null, til dømes 299 eller 1 299,50.'); return; }
    setBusy(true);
    try {
      await pb.collection('settlements').create({
        from_person: transfer.from, to_person: transfer.to, amount: ore,
        kind: mode === 'waive' ? 'waived' : 'paid', method: mode === 'waive' ? '' : method, note: note.trim(), created_by: data.me.id,
      });
      await data.reload('settlements');
      haptic();
      toast(mode === 'pay' && to?.user ? `Sendt til ${firstName(to.name)} for stadfesting` : 'Registrert');
      onDone();
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={submit}>
      {mode === 'pay' && to?.vipps && (
        <div className="vipps-box">
          <div><small>Vipps til {firstName(to.name)}</small><strong>{to.vipps}</strong></div>
          <button type="button" className="btn small ghost" onClick={() => void copy(to.vipps, 'Nummeret er kopiert')}><Copy size={14} /> Nummer</button>
          <button type="button" className="btn small ghost" onClick={() => void copy(String(transfer.ore / 100), 'Beløpet er kopiert')}><Copy size={14} /> Beløp</button>
        </div>
      )}
      <Field label={mode === 'waive' ? 'Kor mykje vil du ettergje?' : 'Beløp'} hint={ore < transfer.ore && ore > 0 ? `Delbetaling. Då står ${money(transfer.ore - ore)} att.` : ore > transfer.ore ? 'Dette er meir enn skulda, så resten snur.' : undefined}>
        <input className="amount-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {mode !== 'waive' && <Segmented label="Betalt med" value={method} onChange={setMethod} options={[{ id: 'vipps', label: 'Vipps' }, { id: 'bank', label: 'Bank' }, { id: 'cash', label: 'Kontant' }, { id: 'other', label: 'Anna' }]} />}
      {mode === 'waive' && <p className="field-hint">{firstName(from?.name)} slepp å betale dette. Du kan angre under Gjort opp.</p>}
      <Field label="Notat"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Valfritt" /></Field>
      <button className="btn primary full" disabled={busy}>{mode === 'pay' ? 'Eg har betalt' : mode === 'receive' ? 'Eg har fått pengane' : 'Ettergje'}</button>
    </form>
  );
}

function TransferCard({ transfer: full }: { transfer: Transfer }) {
  const data = useData();
  const { ledger } = data;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  // Det som alt er meldt betalt og ventar på stadfesting, skal ikkje kunne betalast ein gong til.
  const waiting = data.settlements.filter((s) => s.status === 'pending' && ledger!.wallets[s.from_person] === full.from && ledger!.wallets[s.to_person] === full.to).reduce((sum, s) => sum + s.amount, 0);
  const transfer = { ...full, ore: full.ore - waiting };
  const me = ledger!.me;
  const iOwe = transfer.from === me;
  const theyOwe = transfer.to === me;
  const other = iOwe ? transfer.to : transfer.from;
  const person = data.peopleById.get(other);
  const related = data.expenses.filter((e) => e.parties.some((p) => ledger!.wallets[p] === other) && e.parties.some((p) => ledger!.wallets[p] === me));
  const from = data.peopleById.get(transfer.from);
  const to = data.peopleById.get(transfer.to);
  if (transfer.ore <= 0) return null;

  return (
    <article className={`transfer ${iOwe ? 'owe' : theyOwe ? 'owed' : ''}`}>
      <div className="transfer-main">
        <span className="transfer-people"><Avatar person={from} size={38} /><ArrowRight size={16} /><Avatar person={to} size={38} /></span>
        <div className="transfer-text">
          <p>{iOwe ? <>Du betaler <strong>{firstName(person?.name)}</strong></> : theyOwe ? <><strong>{firstName(person?.name)}</strong> betaler deg</> : <><strong>{firstName(from?.name)}</strong> betaler <strong>{firstName(to?.name)}</strong></>}</p>
          {transfer.simplified && <small><Sparkle size={11} /> Forenkla, sparer overføringar</small>}
        </div>
        <strong className="transfer-amount">{money(transfer.ore)}</strong>
      </div>
      <div className="transfer-actions">
        {iOwe && <button className="btn small primary" onClick={() => setMode('pay')}><Check size={15} /> Eg har betalt</button>}
        {theyOwe && <button className="btn small primary" onClick={() => setMode('receive')}><Check size={15} /> Fått pengane</button>}
        {theyOwe && <button className="btn small ghost" onClick={() => setMode('waive')}><HeartHandshake size={15} /> Ettergje</button>}
        {related.length > 0 && (
          <button className={`why ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>Kvifor? <ChevronDown size={15} /></button>
        )}
      </div>
      <div className={`collapse ${open ? 'open' : ''}`}>
        <div className="collapse-inner">
          <ul className="why-list">
            {related.map((e) => {
              const paid = e.payers.map((p) => firstName(data.peopleById.get(p.person)?.name)).join(', ');
              return <li key={e.id}><span>{expenseTitle(e, data.gifts)}</span><small>{paid} la ut {money(e.amount)}</small></li>;
            })}
          </ul>
          {transfer.simplified && <p className="field-hint">Appen har samla fleire skulder til éi overføring. Summen for kvar person er akkurat den same.</p>}
        </div>
      </div>
      <Sheet open={!!mode} onClose={() => setMode(null)} title={mode === 'pay' ? `Betal ${firstName(person?.name)}` : mode === 'waive' ? 'Ettergje skuld' : `Frå ${firstName(person?.name)}`}>
        {mode && <SettleForm transfer={transfer} mode={mode} onDone={() => setMode(null)} />}
      </Sheet>
    </article>
  );
}

function PendingRow({ s }: { s: Settlement }) {
  const data = useData();
  const toast = useToast();
  const incoming = s.receivers.includes(data.me.id);
  const from = data.peopleById.get(s.from_person);
  const to = data.peopleById.get(s.to_person);
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await data.reload('settlements'); haptic(); } catch (err) { toast(errorText(err)); }
  };
  return (
    <div className="pending">
      <span className="pending-text">
        {incoming ? <><strong>{firstName(from?.name)}</strong> seier {money(s.amount)} er betalt{s.method ? ` med ${METHOD_LABEL[s.method]?.toLowerCase()}` : ''}.</> : <>Ventar på at <strong>{firstName(to?.name)}</strong> stadfestar {money(s.amount)}.</>}
      </span>
      {incoming ? (
        <span className="pending-actions">
          <button className="btn small primary" onClick={() => void act(() => pb.collection('settlements').update(s.id, { status: 'confirmed' }))}>Stadfest</button>
          <button className="btn small ghost" onClick={() => void act(() => pb.collection('settlements').delete(s.id))}>Ikkje motteke</button>
        </span>
      ) : <button className="btn small ghost" onClick={() => void act(() => pb.collection('settlements').delete(s.id))}>Angre</button>}
    </div>
  );
}

function ExpenseRow({ e }: { e: Expense }) {
  const data = useData();
  const toast = useToast();
  const { addExpense } = useGifts();
  const myWallet = data.ledger?.me;
  const canEdit = e.created_by === data.me.id || e.payer_users.includes(data.me.id);
  const iDisputed = e.disputed_by.includes(data.me.id);
  const myShare = Object.entries(e.allocated).filter(([p]) => data.ledger?.wallets[p] === myWallet).reduce((s, [, v]) => s + v, 0);
  const paidBy = e.payers.map((p) => firstName(data.peopleById.get(p.person)?.name)).join(', ');
  const dispute = async () => {
    try { await pb.send(`/api/jul/expenses/${e.id}/dispute`, { method: 'POST' }); await data.reload('expenses'); } catch (err) { toast(errorText(err)); }
  };
  return (
    <li className={`expense ${e.disputed_by.length ? 'disputed' : ''}`}>
      <button className="expense-open" disabled={!canEdit} onClick={() => addExpense({ editing: e })}>
        <span className="expense-text">
          <strong>{e.kind === 'refund' && 'Tilbake: '}{expenseTitle(e, data.gifts)}</strong>
          <small>{paidBy} · {new Date(e.spent_on).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}{e.currency ? ` · ${e.original_amount} ${e.currency}` : ''}</small>
          {e.disputed_by.length > 0 && <small className="warn">Nokon meiner dette ikkje stemmer</small>}
        </span>
        <span className="expense-sum"><strong>{money(e.amount)}</strong>{myShare > 0 && <small>Din del {money(myShare)}</small>}</span>
      </button>
      {!canEdit && <button className={`icon-btn small ${iDisputed ? 'flagged' : ''}`} onClick={() => void dispute()} aria-label={iDisputed ? 'Trekk innvendinga' : 'Dette stemmer ikkje'} title={iDisputed ? 'Trekk innvendinga' : 'Dette stemmer ikkje'}><Flag size={14} /></button>}
    </li>
  );
}

function HistoryRow({ s }: { s: Settlement }) {
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const from = firstName(data.peopleById.get(s.from_person)?.name);
  const to = firstName(data.peopleById.get(s.to_person)?.name);
  const canUndo = s.receivers.includes(data.me.id) || (s.receivers.length === 0 && s.created_by === data.me.id);
  const undo = async () => {
    if (!(await confirm({ title: 'Angre oppgjeret?', body: 'Skulda kjem tilbake.', action: 'Angre', danger: true }))) return;
    try { await pb.collection('settlements').delete(s.id); await data.reload('settlements'); } catch (err) { toast(errorText(err)); }
  };
  return (
    <li className="expense">
      <span className="expense-open static">
        <span className="expense-text"><strong>{s.kind === 'waived' ? `${to} ettergav ${from}` : `${from} betalte ${to}`}</strong><small>{new Date(s.created).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}{s.method ? ` · ${METHOD_LABEL[s.method]}` : ''}{s.note ? ` · ${s.note}` : ''}</small></span>
        <span className="expense-sum"><strong>{money(s.amount)}</strong></span>
      </span>
      {canUndo && <button className="btn small ghost" onClick={() => void undo()}>Angre</button>}
    </li>
  );
}

function HouseholdRequests() {
  const data = useData();
  const toast = useToast();
  const me = data.me.id;
  const requests = data.people.filter((p) => p.covered_request && p.covered_request_by !== me && (p.user === me || data.peopleById.get(p.covered_request)?.user === me));
  if (requests.length === 0) return null;
  const answer = async (personId: string, targetId: string) => {
    try {
      await pb.send('/api/jul/covered-by', { method: 'POST', body: { personId, targetId } });
      await data.reload('people');
      haptic();
    } catch (err) { toast(errorText(err)); }
  };
  return (
    <section>
      <div className="section-head"><h2>Felles økonomi</h2></div>
      <div className="stack-list">
        {requests.map((p) => (
          <div className="pending" key={p.id}>
            <span className="pending-text"><strong>{firstName(data.people.find((x) => x.user === p.covered_request_by)?.name)}</strong> vil at kostnadene til {firstName(p.name)} skal gå via {firstName(data.peopleById.get(p.covered_request)?.name)}.</span>
            <span className="pending-actions">
              <button className="btn small primary" onClick={() => void answer(p.id, p.covered_request)}>Godta</button>
              <button className="btn small ghost" onClick={() => void answer(p.id, '')}>Nei takk</button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SettlePage() {
  const data = useData();
  const { addExpense } = useGifts();
  const { ledger } = data;
  if (!ledger) return data.ledgerFailed ? <LoadError onRetry={data.reloadLedger} /> : <div className="page"><div className="skeleton sk-hero" /></div>;

  const pending = data.settlements.filter((s) => s.status === 'pending');
  const history = data.settlements.filter((s) => s.status === 'confirmed').sort((a, b) => b.created.localeCompare(a.created));
  const expenses = [...data.expenses].sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created.localeCompare(a.created));
  const years = [...new Set(expenses.map((e) => e.year))].sort((a, b) => b - a);
  const net = ledger.owed - ledger.owe;
  const settled = ledger.owe === 0 && ledger.owed === 0;

  return (
    <div className="page">
      <section className="hero ledger-hero">
        <div className="snow" aria-hidden="true" />
        <Garland />
        <div className="hero-text">
          <p className="eyebrow">Oppgjer</p>
          {settled ? <h1 className="ledger-big">Alt er gjort opp</h1> : net >= 0 ? <h1 className="ledger-big"><span>{money(net)}</span> til gode</h1> : <h1 className="ledger-big"><span>{money(-net)}</span> å betale</h1>}
          {!settled && ledger.owe > 0 && ledger.owed > 0 && <p className="hero-sub">Du skuldar {money(ledger.owe)} og har {money(ledger.owed)} til gode.</p>}
        </div>
        <button className="btn gold hero-action" onClick={() => addExpense()}><Plus size={18} /> Nytt utlegg</button>
      </section>

      {ledger.disputed > 0 && <p className="note-bar">Nokon meiner at {ledger.disputed} utlegg ikkje stemmer. Summane står til den som la det inn, har retta det.</p>}

      <HouseholdRequests />

      {pending.length > 0 && <section><div className="section-head"><h2>Ventar på stadfesting</h2></div><div className="stack-list">{pending.map((s) => <PendingRow key={s.id} s={s} />)}</div></section>}

      {ledger.transfers.length > 0 && <section><div className="section-head"><h2>Dette må gjerast</h2></div><div className="stack-list">{ledger.transfers.map((t) => <TransferCard key={`${t.from}-${t.to}`} transfer={t} />)}</div></section>}

      {expenses.length === 0 && history.length === 0 ? (
        <Empty title="Ingen utlegg enno" />
      ) : years.map((year) => (
        <section key={year}>
          <div className="section-head"><h2>Utlegg {year}</h2></div>
          <ul className="expense-list">{expenses.filter((e) => e.year === year).map((e) => <ExpenseRow key={e.id} e={e} />)}</ul>
        </section>
      ))}

      {history.length > 0 && <section><div className="section-head"><h2>Gjort opp</h2></div><ul className="expense-list">{history.map((s) => <HistoryRow key={s.id} s={s} />)}</ul></section>}
    </div>
  );
}
