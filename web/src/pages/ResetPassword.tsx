import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../api';
import { Button, ErrorBanner, PasswordInput } from '../components/ui';
import { apiError } from '../api/client';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!token) { setErr('This link is missing its token. Request a new one.'); return; }
    if (password.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card" style={{ width: 360 }}>
        <h2>Reset password</h2>
        {done ? (
          <p className="meta">Password updated. Redirecting to sign in…</p>
        ) : !token ? (
          <>
            <ErrorBanner msg="This link is missing its token." />
            <Link to="/forgot-password" className="meta">Request a new link</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="meta" style={{ marginTop: -4 }}>Choose a new password for your account.</p>
            <ErrorBanner msg={err} />
            <label>New password</label>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            <label>Confirm password</label>
            <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <Button type="submit" disabled={busy} style={{ width: '100%', marginTop: 16 }}>
              {busy ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
