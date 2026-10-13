import { useEffect, useState } from 'react';
import {
  getPasswordRequests, resolvePasswordRequest, dismissPasswordRequest, type PasswordRequest,
} from '../api';
import { ROLE_LABELS } from '../types';
import { Button, Card, Spinner, ErrorBanner } from '../components/ui';
import { apiError } from '../api/client';

/**
 * Forgot-password requests. Users cannot change their own password: they ask here,
 * an admin sets a new one (typed, or generated) and tells them.
 */
export function PasswordRequests() {
  const [rows, setRows] = useState<PasswordRequest[] | null>(null);
  const [all, setAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Passwords just set, shown once so the admin can pass them on.
  const [issued, setIssued] = useState<Record<string, string>>({});

  async function load() {
    try { setRows(await getPasswordRequests(all ? 'all' : 'pending')); setErr(null); }
    catch (e) { setErr(apiError(e)); }
  }
  useEffect(() => { load(); }, [all]);

  async function resolve(r: PasswordRequest) {
    const pw = (typed[r.id] ?? '').trim();
    if (pw && pw.length < 8) { setErr('A password must be at least 8 characters.'); return; }
    setBusy(r.id); setErr(null);
    try {
      const out = await resolvePasswordRequest(r.id, pw || undefined);
      setIssued((m) => ({ ...m, [r.id]: out.password }));
      await load();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(null); }
  }

  async function dismiss(r: PasswordRequest) {
    if (!confirm(`Dismiss the request from ${r.name}?`)) return;
    setBusy(r.id);
    try { await dismissPasswordRequest(r.id); await load(); }
    catch (e) { setErr(apiError(e)); } finally { setBusy(null); }
  }

  if (!rows) return err ? <ErrorBanner msg={err} /> : <Spinner />;

  return (
    <div>
      <h1>Password requests</h1>
      <p className="meta">Users can't change their own password. Set a new one for them here, then tell them. They are signed out everywhere when you do.</p>
      <ErrorBanner msg={err} />
      <label style={{ display: 'inline-flex', gap: 6, margin: '8px 0 14px' }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} style={{ width: 'auto' }} /> Show handled requests too
      </label>

      {/* Just-issued passwords stay visible even after their request leaves the pending list. */}
      {Object.entries(issued).map(([id, pw]) => (
        <Card key={id} style={{ marginBottom: 10, borderColor: 'var(--success, #16a34a)' }}>
          <div className="meta">New password set — give it to the user now; it won't be shown again here:</div>
          <code style={{ fontSize: 16 }}>{pw}</code>{' '}
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(pw)}>Copy</Button>{' '}
          <Button size="sm" variant="ghost" onClick={() => setIssued(({ [id]: _drop, ...rest }) => rest)}>Done</Button>
        </Card>
      ))}

      {rows.length === 0 && <p className="meta">No {all ? '' : 'pending '}requests.</p>}
      <div className="row-list">
        {rows.map((r) => (
          <Card key={r.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{r.name} <span className="muted">· {ROLE_LABELS[r.role]}</span></div>
                <div className="meta">{r.email}{r.mobile ? ` · ${r.mobile}` : ''}{r.vendor_name ? ` · ${r.vendor_name}` : ''}</div>
                <div className="meta">
                  Asked {new Date(r.created_at).toLocaleString()}
                  {(r.entered_name || r.entered_mobile) && ` · they entered: ${[r.entered_name, r.entered_mobile].filter(Boolean).join(', ')}`}
                </div>
                {r.status !== 'pending' && (
                  <div className="meta">{r.status === 'resolved' ? 'Password set' : 'Dismissed'}
                    {r.resolved_at ? ` ${new Date(r.resolved_at).toLocaleString()}` : ''}{r.resolved_by_name ? ` by ${r.resolved_by_name}` : ''}</div>
                )}
              </div>
              {r.status === 'pending' && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <input
                    style={{ width: 220 }} placeholder="New password (blank = generate)"
                    value={typed[r.id] ?? ''} onChange={(e) => setTyped((m) => ({ ...m, [r.id]: e.target.value }))}
                  />
                  <Button size="sm" disabled={busy === r.id} onClick={() => resolve(r)}>Set password</Button>
                  <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => dismiss(r)}>Dismiss</Button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
