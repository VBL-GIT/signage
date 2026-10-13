import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api';
import { Button, ErrorBanner } from '../components/ui';
import { apiError } from '../api/client';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await forgotPassword(email.trim(), name.trim(), mobile.trim());
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
            <p className="meta">Your request has been sent to the administrator. They will contact you with a new password.</p>
            <Link to="/login" className="meta">← Back to sign in</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="meta" style={{ marginTop: -4 }}>Passwords are set by an administrator. Send a request and they will contact you with a new one.</p>
            <ErrorBanner msg={err} />
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <label>Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <label>Mobile number</label>
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" />
            <Button type="submit" disabled={busy} style={{ width: '100%', marginTop: 16 }}>
              {busy ? 'Sending…' : 'Request new password'}
            </Button>
            <Link to="/login" className="meta" style={{ display: 'block', marginTop: 12 }}>← Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}
