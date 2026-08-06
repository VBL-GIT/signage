import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { Button, ErrorBanner } from '../components/ui';
import { apiError } from '../api/client';

export function Login() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate('/tasks');
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card" style={{ width: 360 }} onSubmit={submit}>
        <h2>Signage Console</h2>
        <p className="meta" style={{ marginTop: -4 }}>RJCorp &amp; Vendor sign in</p>
        <ErrorBanner msg={err} />
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" disabled={busy} style={{ width: '100%', marginTop: 16 }}>
          {busy ? 'Signing in…' : 'Sign In'}
        </Button>
        <Link to="/forgot-password" className="meta" style={{ display: 'block', textAlign: 'center', marginTop: 12 }}>
          Forgot password?
        </Link>
      </form>
    </div>
  );
}
