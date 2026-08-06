import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api';
import { Button, ErrorBanner } from '../components/ui';
import { apiError } from '../api/client';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card" style={{ width: 360 }}>
        <h2>Forgot password</h2>
        {sent ? (
          <>
            <p className="meta">If an account exists for <b>{email.trim()}</b>, we've sent a password reset link. Check your inbox (and spam folder).</p>
            <Link to="/login" className="meta">← Back to sign in</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="meta" style={{ marginTop: -4 }}>Enter your account email and we'll send you a reset link.</p>
            <ErrorBanner msg={err} />
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <Button type="submit" disabled={busy} style={{ width: '100%', marginTop: 16 }}>
              {busy ? 'Sending…' : 'Send reset link'}
            </Button>
            <Link to="/login" className="meta" style={{ display: 'block', marginTop: 12 }}>← Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}
