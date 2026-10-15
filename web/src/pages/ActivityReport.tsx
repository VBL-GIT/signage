import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getActivityReport, getActivitySummary, downloadActivityReport, getVendors, getUsers,
  type ActivityFilters, type ActivityRow, type ActivitySummary,
} from '../api';
import type { Vendor, User } from '../types';
import { useAuth } from '../store/auth';
import { Button, Card, Spinner, ErrorBanner } from '../components/ui';
import { DownloadReportButton } from '../components/DownloadReportButton';
import { apiError } from '../api/client';

const PAGE_SIZE = 50;

const TYPE_LABEL: Record<string, string> = {
  recee: 'Recee', installation_post_recee: 'Installation (After Recee)',
  installation_without_recee: 'Installation Without Recee', pamphlet_distribution: 'Direct Installation',
};
const OUTLET_LABEL: Record<string, string> = { speed: 'SPEED', non_speed: 'Non-SPEED', not_recorded: 'Not recorded' };
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', recee_submitted: 'Awaiting review', recee_approved: 'Recee approved',
  recee_rejected: 'Rejected (rework)', installed: 'Installed', completed: 'Completed', cancelled: 'Cancelled',
};

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * The one consolidated activity report. One row = one task record: a task that is
 * rejected, reassigned or resubmitted is still one row (see the counts in the
 * columns), so nothing is double-counted. Scope (vendor etc.) is enforced by the
 * server from the logged-in user; the vendor filter below only appears for head
 * office and cannot widen a vendor user's view.
 */
export function ActivityReport() {
  const role = useAuth().user?.role;
  const isHeadOffice = role === 'rjcorp_admin' || role === 'rjcorp_user';

  const [filters, setFilters] = useState<ActivityFilters>({});
  const [applied, setApplied] = useState<ActivityFilters>({});
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);

  useEffect(() => {
    if (isHeadOffice) getVendors().then(setVendors).catch(() => undefined);
    getUsers({ role: 'employee' }).then(setEmployees).catch(() => undefined);
  }, [isHeadOffice]);

  useEffect(() => {
    setRows(null); setErr(null);
    Promise.all([getActivityReport(applied, page, PAGE_SIZE), page === 1 ? getActivitySummary(applied) : Promise.resolve(null)])
      .then(([r, s]) => { setRows(r.rows); setTotal(r.total); if (s) setSummary(s); })
      .catch((e) => { setErr(apiError(e)); setRows([]); });
  }, [applied, page]);

  const set = (k: keyof ActivityFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  const apply = () => { setPage(1); setApplied({ ...filters }); };
  const reset = () => { setFilters({}); setPage(1); setApplied({}); };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const t = summary?.totals;
  const byEmployeeTop = useMemo(() => (summary?.by_employee ?? []).slice(0, 15), [summary]);
  const maxEmp = Math.max(1, ...byEmployeeTop.map((r) => r.assigned + r.unassigned));
  // Activity-type rows with Assigned/Unassigned folded together.
  const typeRows = useMemo(() => {
    const m = new Map<string, { type: string; a: number; u: number }>();
    for (const r of summary?.by_type ?? []) {
      const row = m.get(r.activity_type) ?? { type: r.activity_type, a: 0, u: 0 };
      if (r.activity_origin === 'UNASSIGNED') row.u += r.n; else row.a += r.n;
      m.set(r.activity_type, row);
    }
    return [...m.values()];
  }, [summary]);
  const maxType = Math.max(1, ...typeRows.map((r) => r.a + r.u));

  return (
    <div>
      <h1>Activity Report</h1>
      <p className="meta">All activity types in one place. Assigned = created by an admin; Unassigned = started by an employee in the field. One row per task.</p>
      <ErrorBanner msg={err} />

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <div><label>From</label><input type="date" value={filters.date_from ?? ''} onChange={set('date_from')} /></div>
          <div><label>To</label><input type="date" value={filters.date_to ?? ''} onChange={set('date_to')} /></div>
          <div><label>Activity type</label>
            <select value={filters.activity_type ?? ''} onChange={set('activity_type')}>
              <option value="">All</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label>Origin</label>
            <select value={filters.origin ?? ''} onChange={set('origin')}>
              <option value="">All</option><option value="ASSIGNED">Assigned</option><option value="UNASSIGNED">Unassigned</option>
            </select></div>
          {isHeadOffice && (
            <div><label>Vendor</label>
              <select value={filters.vendor_id ?? ''} onChange={set('vendor_id')}>
                <option value="">All</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select></div>
          )}
          <div><label>Employee</label>
            <select value={filters.employee_id ?? ''} onChange={set('employee_id')}>
              <option value="">All</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></div>
          <div><label>Outlet type</label>
            <select value={filters.outlet_type ?? ''} onChange={set('outlet_type')}>
              <option value="">All</option>
              {Object.entries(OUTLET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label>Status</label>
            <select value={filters.status ?? ''} onChange={set('status')}>
              <option value="">All (excl. cancelled)</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div style={{ gridColumn: 'span 2' }}><label>Search</label>
            <input placeholder="Activity ID, outlet name, Customer Code…" value={filters.q ?? ''} onChange={set('q')}
              onKeyDown={(e) => e.key === 'Enter' && apply()} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Button onClick={apply}>Apply filters</Button>
          <Button variant="secondary" onClick={reset}>Reset</Button>
          <DownloadReportButton label="Export filtered CSV" filenamePrefix="activity-report" fetcher={() => downloadActivityReport(applied)} />
        </div>
      </Card>

      {t && (
        <div className="stat-grid">
          {([
            ['Total activities', t.total, true], ['Assigned', t.assigned, false], ['Unassigned', t.unassigned, true],
            ['Pending', t.pending, false], ['Awaiting review', t.awaiting_review, false], ['Approved', t.approved, false],
            ['Rejected – rework', t.rejected_awaiting_rework, false], ['Completed', t.completed, false],
            ['New outlets from field', t.new_outlets_from_field, false],
          ] as [string, number, boolean][]).map(([label, n, hl]) => (
            <div key={label} className={`stat ${hl ? 'hl' : ''}`}><div className="n">{n}</div><div className="l">{label}</div></div>
          ))}
        </div>
      )}

      {summary && (
        <div className="grid2" style={{ marginBottom: 14 }}>
          <Card>
            <h3>By activity type</h3>
            {typeRows.length === 0 && <div className="muted">No data</div>}
            {typeRows.map((r) => (
              <div key={r.type} className="bar-row">
                <span>{TYPE_LABEL[r.type] ?? r.type}</span>
                <span className="meta"><b>{r.a + r.u}</b> · {r.a} assigned · {r.u} unassigned</span>
                <div className="bar-track">
                  <div className="bar-a" style={{ width: `${(r.a / maxType) * 100}%` }} />
                  <div className="bar-u" style={{ width: `${(r.u / maxType) * 100}%` }} />
                </div>
              </div>
            ))}
            <h3 style={{ marginTop: 14 }}>SPEED vs Non-SPEED</h3>
            <div className="chips">
              {summary.by_outlet_type.map((r) => <span key={r.outlet_type} className="badge nonspeed">{OUTLET_LABEL[r.outlet_type]}: {r.n}</span>)}
            </div>
          </Card>
          <Card>
            <h3>Assigned vs Unassigned — by employee</h3>
            {byEmployeeTop.length === 0 && <div className="muted">No data</div>}
            {byEmployeeTop.map((r) => (
              <div key={r.employee_id ?? 'none'} className="bar-row">
                <span>{r.employee_name ?? 'No employee'}</span>
                <span className="meta">{r.assigned} assigned · {r.unassigned} unassigned</span>
                <div className="bar-track">
                  <div className="bar-a" style={{ width: `${(r.assigned / maxEmp) * 100}%` }} />
                  <div className="bar-u" style={{ width: `${(r.unassigned / maxEmp) * 100}%` }} />
                </div>
              </div>
            ))}
            {isHeadOffice && (
              <>
                <h3 style={{ marginTop: 14 }}>By vendor</h3>
                {summary.by_vendor.map((r) => (
                  <div key={r.vendor_id ?? 'none'} className="bar-row">
                    <span>{r.vendor_name ?? 'No vendor'}</span>
                    <span className="meta">{r.assigned} assigned · {r.unassigned} unassigned</span>
                  </div>
                ))}
              </>
            )}
            <div className="meta" style={{ marginTop: 8 }}><span style={{ color: 'var(--brand)' }}>■</span> Assigned &nbsp; <span style={{ color: 'var(--accent)' }}>■</span> Unassigned</div>
          </Card>
        </div>
      )}

      {!rows ? <Spinner /> : rows.length === 0 ? (
        <Card><div className="muted">No activities match these filters.</div></Card>
      ) : (
        <>
          <h3 style={{ margin: '6px 0 10px' }}>Activities <span className="muted" style={{ fontWeight: 500 }}>({total})</span></h3>
          {rows.map((r) => {
            const unassigned = r.activity_origin === 'UNASSIGNED';
            const title = r.activity_type === 'recee' ? (unassigned ? 'Unassigned Recee' : 'Assigned Recee') : TYPE_LABEL[r.activity_type];
            const reassigned = Math.max(0, r.assignments - 1);
            const stages: [string, string | null][] = [
              ['Created', r.created_at], ['Submitted', r.submitted_at], ['Reviewed', r.reviewed_at], ['Completed', r.completed_at],
            ];
            return (
              <div key={r.activity_id} className="act">
                <div className="act-head">
                  <span className="title">{title}</span>
                  <span className={`badge origin-${unassigned ? 'u' : 'a'}`}>{unassigned ? 'Unassigned' : 'Assigned'}</span>
                  <span className={`badge ${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                  {r.outlet_type !== 'not_recorded' && (
                    <span className={`badge ${r.outlet_type === 'speed' ? 'speed' : 'nonspeed'}`}>{OUTLET_LABEL[r.outlet_type]}</span>
                  )}
                  {r.new_outlet && <span className="badge new">New outlet</span>}
                  <Link to={`/tasks/${r.activity_id}`} className="id">#{r.activity_id.slice(0, 8)} →</Link>
                </div>

                <div className="act-body">
                  <div className="act-sec">
                    <h4>Outlet</h4>
                    <div className="v">{dash(r.outlet_name)}</div>
                    <div className="s">{dash(r.outlet_address)}</div>
                    <div className="s">
                      {r.customer_code ? `Customer Code ${r.customer_code}` : 'No Customer Code'}
                    </div>
                  </div>
                  <div className="act-sec">
                    <h4>People</h4>
                    <div className="v">{dash(r.employee_name)}</div>
                    <div className="s">Vendor: {dash(r.vendor_name)}</div>
                    <div className="s">
                      {reassigned > 0
                        ? `Reassigned ${reassigned}× · originally ${dash(r.original_employee_name)}`
                        : 'Not reassigned'}
                    </div>
                  </div>
                  <div className="act-sec">
                    <h4>Work</h4>
                    <div className="v">{[r.brand, r.artwork].filter(Boolean).join(' · ') || '—'}</div>
                    <div className="s">Size: {dash(r.dimensions)}</div>
                    {(r.target_pamphlet_count != null || r.reported_pamphlets != null) && (
                      <div className="s">Pamphlets: {dash(r.reported_pamphlets)} of {dash(r.target_pamphlet_count)}</div>
                    )}
                    <div className="s">{r.photo_count} photo{r.photo_count === 1 ? '' : 's'} · {r.submission_attempts} submission{r.submission_attempts === 1 ? '' : 's'}</div>
                  </div>
                </div>

                {r.rejection_reason && <div className="reject"><b>Rejected:</b> {r.rejection_reason}</div>}

                <div className="steps">
                  {stages.map(([label, when]) => (
                    <div key={label} className={when ? '' : 'off'}>{label}<b>{when ?? '—'}</b></div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</Button>
        <span className="meta">Page {page} of {pages} · {total} activities</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</Button>
      </div>
    </div>
  );
}
