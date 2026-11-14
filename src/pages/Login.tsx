import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, emailIsDeveloperCandidate } from '../store/auth';
import { useToast } from '../components/ui';

export function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const devMode = new URLSearchParams(loc.search).get('dev') === '1';

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setHint('');
    try {
      await login(email, pw);
      const mail = email.trim().toLowerCase();
      if (devMode && !emailIsDeveloperCandidate(mail)) {
        setHint('This email is not on the developer allowlist (VITE_DEVELOPER_EMAILS).');
      }
      nav('/', { replace: true });
    } catch (err) {
      const msg = (err as { code?: string }).code;
      if (msg === 'auth/invalid-credential' || msg === 'auth/wrong-password') setHint('Wrong email or password.');
      else if (msg === 'auth/too-many-requests') setHint('Too many attempts. Wait a minute and retry.');
      else setHint((err as Error).message);
      toast('err', 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">🍺 <span>AdvancePOS</span></div>
        <div className="login-sub">{devMode ? 'Developer sign-in' : 'Sign in to start billing'}</div>
        <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete={devMode ? 'off' : 'current-password'} />
        {hint && <div className="login-hint">{hint}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="login-links">
          {devMode
            ? <button type="button" className="linklike" onClick={() => nav('/login')}>← staff sign-in</button>
            : <button type="button" className="linklike subtle-link" onClick={() => nav('/login?dev=1')}>·</button>}
        </div>
      </form>
    </div>
  );
}
