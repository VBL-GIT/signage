import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { getUsers, getVendors, getTask, assignTask } from '../api';
import type { User, Task, Vendor } from '../types';
import { useAuth } from '../store/auth';
import { Button, Card, Spinner, ErrorBanner } from '../components/ui';
import { apiError } from '../api/client';

type Scope = 'vendor' | 'all';

export function Assign() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  // Where to return after assigning (defaults to this task). Used so assigning a
  // post-recee install from the recee's detail returns to the recee, not the child.
  const backTo = sp.get('back') || `/tasks/${id}`;
  const role = useAuth().user?.role;
  const isHeadOffice = role === 'rjcorp_admin' || role === 'rjcorp_user';

  const [task, setTask] = useState<Task | null>(null);
  const [employees, setEmployees] = useState<User[]>([]);
  const [vendorName, setVendorName] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<Scope>('vendor');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<User | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const preselected = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    // Head office can pull all employees + vendor names to allow cross-vendor assignment.
    Promise.all([getTask(id), getUsers({ role: 'employee' }), isHeadOffice ? getVendors() : Promise.resolve([] as Vendor[])])
      .then(([t, emps, vendors]) => {
        setTask(t);
        setEmployees(emps);
        setVendorName(Object.fromEntries(vendors.map((v) => [v.id, v.name])));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, isHeadOffice]);

  // A rejected recee goes back for rework: the previous employee is preselected,
  // and the admin can keep them or choose someone else — after confirming.
  const isRework = task?.status === 'recee_rejected';
  useEffect(() => {
    if (preselected.current || !task || !isRework || !task.employee_id) return;
    const prev = employees.find((e) => e.id === task.employee_id);
    if (prev) { setSelected(prev); setQuery(prev.name); preselected.current = true; }
  }, [task, employees, isRework]);

  // Base list: the task's vendor by default; all vendors when a head-office user opts in.
  const base = useMemo(() => {
    if (scope === 'all' && isHeadOffice) return employees;
    return employees.filter((e) => e.vendor_id === task?.vendor_id);
  }, [employees, scope, isHeadOffice, task]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (e.uid ?? '').toLowerCase().includes(q)
    );
  }, [query, base]);

  async function submit() {
    if (!selected) { setErr('Search and select an employee'); return; }
    if (isRework && !confirmed) { setErr('Tick the confirmation to send this recee back for rework'); return; }
    setBusy(true); setErr(null);
    try {
      await assignTask(id!, selected.id, isRework ? true : undefined);
      navigate(backTo);
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  if (loading) return <Spinner />;

  const crossVendor = selected && task && selected.vendor_id !== task.vendor_id;

  return (
    <div>
      <Link to={backTo} className="meta">← Task</Link>
      <h1>{isRework ? 'Rework rejected recee' : 'Assign to Employee'}</h1>
      <ErrorBanner msg={err} />

      <Card style={{ maxWidth: 560 }}>
        {isRework && (
          <div style={{ marginBottom: 12 }}>
            <div className="meta"><b>This recee was rejected.</b> The submission and rejection reason stay in the history. Choose who redoes it.</div>
            {(() => {
              const rej = [...(task?.steps ?? [])].reverse().find((s) => s.step_type === 'approval' && s.approval_status === 'rejected');
              return rej?.rejection_reason ? <div className="meta">Reason: “{rej.rejection_reason}”</div> : null;
            })()}
            {task?.employee_name && <div className="meta">Previously assigned: <b>{task.employee_name}</b> (preselected)</div>}
          </div>
        )}
        {isHeadOffice && (
          <>
            <label>Employee pool</label>
            <div className="chips" style={{ marginBottom: 10 }}>
              <div className={`chip ${scope === 'vendor' ? 'on' : ''}`} onClick={() => { setScope('vendor'); setSelected(null); }}>
                This vendor{task?.vendor_name ? ` · ${task.vendor_name}` : ''}
              </div>
              <div className={`chip ${scope === 'all' ? 'on' : ''}`} onClick={() => { setScope('all'); setSelected(null); }}>
                All vendors
              </div>
            </div>
          </>
        )}

        <label>Search employee</label>
        <input
          autoFocus
          placeholder="Type a name, UID or email…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
        />

        {selected && (
          <div className="meta" style={{ marginTop: 8 }}>
            Selected: <b>{selected.name}</b>{selected.uid ? ` · ${selected.uid}` : ''} ({selected.email})
            {crossVendor && (
              <div style={{ color: 'var(--danger)', marginTop: 4 }}>
                ⚠ This employee is in another vendor{selected.vendor_id ? ` (${vendorName[selected.vendor_id] ?? 'unknown'})` : ''}. The task will move to that vendor.
              </div>
            )}
          </div>
        )}

        <div className="combo-list">
          {filtered.length === 0 && <div className="meta" style={{ padding: 10 }}>No matches</div>}
          {filtered.map((e) => (
            <div
              key={e.id}
              className={`combo-row ${selected?.id === e.id ? 'sel' : ''}`}
              onClick={() => setSelected(e)}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{e.name} {e.uid && <span className="muted">· {e.uid}</span>}</div>
                <div className="meta">
                  {e.email}
                  {scope === 'all' && e.vendor_id && vendorName[e.vendor_id] ? ` · ${vendorName[e.vendor_id]}` : ''}
                </div>
              </div>
              {selected?.id === e.id && <span style={{ color: 'var(--brand)', fontWeight: 700 }}>✓</span>}
            </div>
          ))}
        </div>

        {isRework && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ width: 'auto' }} />
            I confirm sending this recee back to {selected ? selected.name : 'the selected employee'} for rework
          </label>
        )}

        <Button onClick={submit} disabled={busy || !selected || (isRework && !confirmed)} style={{ marginTop: 16 }}>
          {busy ? 'Saving…' : isRework ? 'Confirm rework assignment' : 'Assign'}
        </Button>
      </Card>
    </div>
  );
}
