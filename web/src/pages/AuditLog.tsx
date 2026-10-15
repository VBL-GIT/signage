import { useEffect, useState } from 'react';
import { getAudit, getAuditActors, type AuditEntry, type AuditFilters } from '../api';
import { useAuth } from '../store/auth';
import { Button, Card, Spinner, ErrorBanner } from '../components/ui';
import { apiError } from '../api/client';

const PAGE_SIZE = 50;
const ENTITIES = ['user', 'role', 'vendor', 'store', 'task', 'artwork', 'brand', 'password_request'];
const ROLE_SHORT: Record<string, string> = {
  rjcorp_admin: 'RJCorp Admin', rjcorp_user: 'RJCorp User', vendor_admin: 'Vendor Admin', vendor_user: 'Vendor User',
};

/** Who changed what, newest first — each change attributed to the email that made it. RJ admin only. */
export function AuditLog() {
  const role = useAuth().user?.role;
  const [filters, setFilters] = useState<AuditFilters>({ actor_role: 'rjcorp_admin' });
  const [applied, setApplied] = useState<AuditFilters>({ actor_role: 'rjcorp_admin' });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [actors, setActors] = useState<{ actor_email: string; actor_name: string | null; actor_role: string | null; changes: number; last_change: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (role === 'rjcorp_admin') getAuditActors().then(setActors).catch(() => undefined);
  }, [role]);

  useEffect(() => {
    if (role !== 'rjcorp_admin') return;
    setRows(null); setErr(null);
    getAudit(applied, page, PAGE_SIZE)
      .then((r) => { setRows(r.rows); setTotal(r.total); })
      .catch((e) => { setErr(apiError(e)); setRows([]); });
  }, [applied, page, role]);

  if (role !== 'rjcorp_admin') return <p>This page is only available to RJCorp admins.</p>;

  const set = (k: keyof AuditFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1>Audit Log</h1>
      <p className="meta">Changes made by RJ admins, with the email of the admin who made each one. Click an admin to see only their changes.</p>
      <div className="chips" style={{ marginBottom: 12 }}>
        {(() => {
          const pick = (f: AuditFilters) => { setFilters(f); setApplied(f); setPage(1); };
          const admins = actors.filter((a) => a.actor_role === 'rjcorp_admin');
          return (
            <>
              <div className={`chip ${!applied.actor && applied.actor_role === 'rjcorp_admin' ? 'on' : ''}`} onClick={() => pick({ actor_role: 'rjcorp_admin' })}>
                All RJ admins ({admins.reduce((n, a) => n + a.changes, 0)})
              </div>
              {admins.map((a) => (
                <div key={a.actor_email} className={`chip ${applied.actor === a.actor_email ? 'on' : ''}`} onClick={() => pick({ actor: a.actor_email })}
                  title={`Last change ${new Date(a.last_change).toLocaleString()}`}>
                  {a.actor_name ? `${a.actor_name} · ` : ''}{a.actor_email} ({a.changes})
                </div>
              ))}
              <div className={`chip ${!applied.actor && !applied.actor_role ? 'on' : ''}`} onClick={() => pick({})}>Everyone (incl. vendors / users)</div>
            </>
          );
        })()}
      </div>
      <ErrorBanner msg={err} />

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <div><label>Changed by</label>
            <select value={filters.actor ?? ''} onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value, actor_role: e.target.value ? undefined : f.actor_role }))}>
              <option value="">{filters.actor_role === 'rjcorp_admin' ? 'All RJ admins' : 'Anyone'}</option>
              {actors.filter((a) => !filters.actor_role || a.actor_role === filters.actor_role).map((a) => <option key={a.actor_email} value={a.actor_email}>{a.actor_email} ({a.changes})</option>)}
            </select></div>
          <div><label>What</label>
            <select value={filters.entity_type ?? ''} onChange={set('entity_type')}>
              <option value="">Everything</option>
              {ENTITIES.map((e) => <option key={e} value={e}>{e.replace('_', ' ')}</option>)}
            </select></div>
          <div><label>From</label><input type="date" value={filters.date_from ?? ''} onChange={set('date_from')} /></div>
          <div><label>To</label><input type="date" value={filters.date_to ?? ''} onChange={set('date_to')} /></div>
          <div style={{ gridColumn: 'span 2' }}><label>Search</label>
            <input placeholder="Email, store, user, role…" value={filters.q ?? ''} onChange={set('q')}
              onKeyDown={(e) => e.key === 'Enter' && (setPage(1), setApplied({ ...filters }))} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button onClick={() => { setPage(1); setApplied({ ...filters }); }}>Apply</Button>
          <Button variant="secondary" onClick={() => { setFilters({ actor_role: 'rjcorp_admin' }); setPage(1); setApplied({ actor_role: 'rjcorp_admin' }); }}>Reset</Button>
        </div>
      </Card>

      {!rows ? <Spinner /> : rows.length === 0 ? (
        <Card><div className="muted">No changes recorded yet. Changes made from now on appear here.</div></Card>
      ) : rows.map((r) => (
        <div key={r.id} className="act">
          <div className="act-head">
            <span className="title">{r.actor_email}</span>
            {r.actor_role && <span className="badge origin-a">{ROLE_SHORT[r.actor_role] ?? r.actor_role}</span>}
            {r.entity_type && <span className="badge nonspeed">{r.entity_type.replace('_', ' ')}</span>}
            <span className="id">{new Date(r.created_at).toLocaleString()}</span>
          </div>
          <div style={{ padding: '10px 14px' }}>
            <div style={{ fontWeight: 600 }}>{r.description}{r.entity_label ? ` — ${r.entity_label}` : ''}</div>
            {r.entity_id && <div className="meta">ID: {r.entity_id}</div>}
            {r.details && (
              <details style={{ marginTop: 6 }}>
                <summary className="meta" style={{ cursor: 'pointer' }}>Details</summary>
                <pre style={{ margin: '6px 0 0', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(r.details, null, 2)}</pre>
              </details>
            )}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</Button>
        <span className="meta">Page {page} of {pages} · {total} changes</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</Button>
      </div>
    </div>
  );
}
