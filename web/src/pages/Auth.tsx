import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorText, pb } from '../lib';
import { useAuth } from '../data';
import { Field, Logo } from '../ui';
import { Garland } from '../decor';

function AuthFrame({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-art" aria-hidden="true">
        <div className="snow" />
        <Garland />
        <div className="auth-brand"><Logo size={40} /><span>Pakke<i>lapp</i></span></div>
        <div className="auth-tag">
          <span className="tag-hole" />
          <p><em>Til</em> heile familien</p>
          <p><em>Frå</em> ein stad å samle alt</p>
        </div>
        <p className="auth-line">Ingen dobbeltkjøp.<br />Ingen avslørte overraskingar.</p>
      </section>
      <main className="auth-form">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="lead">{lead}</p>
          {children}
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Når innlogginga er klar, sender ruta deg vidare dit du var på veg.
      await pb.collection('users').authWithPassword(email.trim().toLowerCase(), password);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 400 ? 'Feil e-post eller passord.' : status === 403 ? 'Kontoen er sett på pause. Snakk med administrator.' : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Velkomen inn" lead="Logg inn for å sjå ønskelister og gåveplanar.">
      <form className="form" onSubmit={submit}>
        <Field label="E-post"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Passord"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary full" disabled={busy}>{busy ? 'Loggar inn …' : 'Logg inn'}</button>
      </form>
      <p className="auth-foot">Ny her? Be nokon i familien om invitasjonslenka. Gløymt passordet? Eigaren av appen kan lage ei ny lenke til deg.</p>
    </AuthFrame>
  );
}

export function JoinPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const [valid, setValid] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pb.send(`/api/jul/invite/${encodeURIComponent(code)}`, {})
      .then(() => setValid(true))
      .catch(() => setValid(false));
  }, [code]);

  useEffect(() => { if (auth) navigate('/', { replace: true }); }, [auth, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await pb.send<{ token: string; record: never }>('/api/jul/register', { method: 'POST', body: { code, name: name.trim(), email: email.trim(), password } });
      pb.authStore.save(res.token, res.record);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (valid === false) {
    return (
      <AuthFrame title="Invitasjonen verkar ikkje" lead="Be om ei ny lenke frå nokon i familien.">
        <Link className="btn ghost full" to="/login">Til innlogging</Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Bli med i jula" lead="Lag din eigen konto. Det tek eit halvt minutt.">
      <form className="form" onSubmit={submit}>
        <Field label="Namnet ditt"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} /></Field>
        <Field label="E-post"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
        <Field label="Vel eit passord" hint="Minst 8 teikn"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} /></Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary full" disabled={busy || valid === null}>{busy ? 'Opprettar …' : 'Bli med'}</button>
      </form>
      <p className="auth-foot">Har du alt konto? <Link to="/login">Logg inn</Link></p>
    </AuthFrame>
  );
}

export function ResetPage() {
  const { token = '' } = useParams();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await pb.collection('users').confirmPasswordReset(token, password, password);
      setDone(true);
    } catch (err) {
      setError(errorText(err, 'Lenka er utgått. Be om ei ny.'));
    }
  };

  return (
    <AuthFrame title="Nytt passord" lead={done ? 'Passordet er endra.' : 'Vel eit nytt passord på minst 8 teikn.'}>
      {done ? (
        <Link className="btn primary full" to="/login">Logg inn</Link>
      ) : (
        <form className="form" onSubmit={submit}>
          <Field label="Nytt passord"><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoFocus /></Field>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary full">Lagre passordet</button>
        </form>
      )}
    </AuthFrame>
  );
}
