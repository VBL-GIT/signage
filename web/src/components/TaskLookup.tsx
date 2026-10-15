import { useState } from 'react';
import { Link } from 'react-router-dom';
import { lookupTasks, type TaskLookupRow } from '../api';
import { progressStages } from '../lib/progress';
import { taskTypeLabel } from '../lib/taskLabels';
import { Button, Card, ErrorBanner } from './ui';
import { apiError } from '../api/client';

const STATUS_TEXT: Record<string, string> = {
  pending: 'Pending', recee_submitted: 'Awaiting review', recee_approved: 'Recee approved',
  recee_rejected: 'Rejected — awaiting rework', installed: 'Installed', completed: 'Completed', cancelled: 'Cancelled',
};
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** Look a task up by its ID (or the first characters of it) and see how far it has got. */
export function TaskLookup() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<TaskLookupRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(null); setBusy(true);
    try { setRows(await lookupTasks(q.trim())); }
    catch (ex) { setRows(null); setErr(apiError(ex)); }
    finally { setBusy(false); }
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <form onSubmit={search} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ flex: '1 1 260px', maxWidth: 420 }}
          placeholder="Track a task — enter its Task ID (e.g. ab3c5519)"
          value={q} onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" disabled={busy || q.trim().length < 4}>{busy ? 'Searching…' : 'Search'}</Button>
        {rows && <Button type="button" variant="ghost" onClick={() => { setRows(null); setQ(''); }}>Clear</Button>}
      </form>
      <ErrorBanner msg={err} />
      {rows && rows.length === 0 && <div className="muted" style={{ marginTop: 10 }}>No task found with that ID.</div>}
      {rows?.map((t) => (
        <div key={t.id} className="act" style={{ marginTop: 12 }}>
          <div className="act-head">
            <span className="title">{taskTypeLabel(t)}</span>
            <span className={`badge ${t.status}`}>{STATUS_TEXT[t.status] ?? t.status}</span>
            <Link to={`/tasks/${t.id}`} className="id">#{t.id.slice(0, 8)} · Open →</Link>
          </div>
          <div style={{ padding: '10px 14px' }}>
            <div style={{ fontWeight: 600 }}>{t.store_name ?? 'No outlet'}</div>
            <div className="meta">{[t.store_address, t.employee_name ? `Employee: ${t.employee_name}` : 'Unassigned', t.vendor_name].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="track">
            {progressStages(t).map((s) => (
              <div key={s.label} className={`track-step ${s.state}`}>
                <span className="dot" />
                <b>{s.label}</b>
                <span className="when">{s.at ? fmt(s.at) : s.state === 'current' ? 'In progress' : ''}</span>
              </div>
            ))}
          </div>
          {t.rejection_reason && t.status === 'recee_rejected' && <div className="reject"><b>Rejected:</b> {t.rejection_reason}</div>}
        </div>
      ))}
    </Card>
  );
}
