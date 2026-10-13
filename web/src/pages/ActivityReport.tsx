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
  installation_without_recee: 'Installation Without Recee', pamphlet_distribution: 'Pamphlet Distribution',
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
            <input placeholder="Activity ID, outlet name, SPEED ID, Customer Code…" value={filters.q ?? ''} onChange={set('q')}
              onKeyDown={(e) => e.key === 'Enter' && apply()} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Button onClick={apply}>Apply filters</Button>
          <Button variant="secondary" onClick={reset}>Reset</Button>
          <DownloadReportButton label="Export filtered CSV" filenamePrefix="activity-report" fetcher={() => downloadActivityReport(applied)} />
        </div>
      </Card>

      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
          {([
            ['Total activities', t.total], ['Assigned', t.assigned], ['Unassigned', t.unassigned],
            ['Pending', t.pending], ['Awaiting review', t.awaiting_review], ['Approved', t.approved],
            ['Rejected – awaiting rework', t.rejected_awaiting_rework], ['Completed', t.completed],
            ['New outlets from field', t.new_outlets_from_field],
          ] as [string, number][]).map(([label, n]) => (
            <Card key={label}><div className="meta">{label}</div><div style={{ fontSize: 24, fontWeight: 800 }}>{n}</div></Card>
          ))}
        </div>
      )}

      {summary && (
        <div className="grid2" style={{ marginBottom: 14 }}>
          <Card>
            <h3>By activity type</h3>
            {summary.by_type.length === 0 && <div className="muted">No data</div>}
            {summary.by_type.map((r) => (
              <div key={r.activity_type + r.activity_origin} className="meta">
                {TYPE_LABEL[r.activity_type] ?? r.activity_type} · {r.activity_origin === 'UNASSIGNED' ? 'Unassigned' : 'Assigned'}: <b>{r.n}</b>
              </div>
            ))}
            <h3 style={{ marginTop: 12 }}>SPEED vs Non-SPEED</h3>
            {summary.by_outlet_type.map((r) => <div key={r.outlet_type} className="meta">{OUTLET_LABEL[r.outlet_type]}: <b>{r.n}</b></div>)}
          </Card>
          <Card>
            <h3>Assigned vs Unassigned by employee</h3>
            {byEmployeeTop.length === 0 && <div className="muted">No data</div>}
            {byEmployeeTop.map((r) => (
              <div key={r.employee_id ?? 'none'} className="meta">{r.employee_name ?? 'No employee'}: {r.assigned} assigned · {r.unassigned} unassigned</div>
            ))}
            {isHeadOffice && (
              <>
                <h3 style={{ marginTop: 12 }}>By vendor</h3>
                {summary.by_vendor.map((r) => (
                  <div key={r.vendor_id ?? 'none'} className="meta">{r.vendor_name ?? 'No vendor'}: {r.assigned} assigned · {r.unassigned} unassigned</div>
                ))}
              </>
            )}
          </Card>
        </div>
      )}

      {!rows ? <Spinner /> : rows.length === 0 ? (
        <Card><div className="muted">No activities match these filters.</div></Card>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 1500 }}>
            <thead>
              <tr>
                <th>Activity</th><th>Type</th><th>Origin</th><th>Status</th><th>Created</th><th>Submitted</th><th>Reviewed</th><th>Completed</th>
                <th>Outlet</th><th>Outlet type / SPEED ID</th><th>Customer Code</th><th>Vendor</th><th>Employee</th>
                <th>Original employee</th><th>Reassigned</th><th>Attempts</th><th>Rejection reason</th><th>Brand / Artwork</th><th>Dimensions</th><th>Pamphlets</th><th>Photos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.activity_id}>
                  <td><Link to={`/tasks/${r.activity_id}`}>{r.activity_id.slice(0, 8)}</Link></td>
                  <td>{r.activity_type === 'recee' ? (r.activity_origin === 'UNASSIGNED' ? 'Unassigned Recee' : 'Assigned Recee') : TYPE_LABEL[r.activity_type]}</td>
                  <td>{r.activity_origin === 'UNASSIGNED' ? 'Unassigned' : 'Assigned'}</td>
                  <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td>{dash(r.created_at)}</td><td>{dash(r.submitted_at)}</td><td>{dash(r.reviewed_at)}</td><td>{dash(r.completed_at)}</td>
                  <td><div>{dash(r.outlet_name)}{r.new_outlet ? ' (new)' : ''}</div><div className="meta">{dash(r.outlet_address)}</div></td>
                  <td>{OUTLET_LABEL[r.outlet_type]}{r.speed_id ? ` · ${r.speed_id}` : ''}</td>
                  <td>{dash(r.customer_code)}</td><td>{dash(r.vendor_name)}</td><td>{dash(r.employee_name)}</td>
                  <td>{dash(r.original_employee_name)}</td><td>{Math.max(0, r.assignments - 1)}</td><td>{r.submission_attempts}</td>
                  <td>{dash(r.rejection_reason)}</td>
                  <td>{[r.brand, r.artwork].filter(Boolean).join(' / ') || '—'}</td><td>{dash(r.dimensions)}</td>
                  <td>{r.target_pamphlet_count != null || r.reported_pamphlets != null ? `${dash(r.reported_pamphlets)} / ${dash(r.target_pamphlet_count)}` : '—'}</td>
                  <td>{r.photo_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</Button>
        <span className="meta">Page {page} of {pages} · {total} activities</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</Button>
      </div>
    </div>
  );
}
