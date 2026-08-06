import { useEffect, useMemo, useState } from 'react';
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
    setBusy(true); setErr(null);
    try {
      await assignTask(id!, selected.id);
      navigate(backTo);
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  if (loading) return <Spinner />;

  const crossVendor = selected && task && selected.vendor_id !== task.vendor_id;

  return (
    <div>
      <Link to={backTo} className="meta">← Task</Link>
      <h1>Assign to Employee</h1>
      <ErrorBanner msg={err} />

      <Card style={{ maxWidth: 560 }}>
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

        <Button onClick={submit} disabled={busy || !selected} style={{ marginTop: 16 }}>
          {busy ? 'Assigning…' : 'Assign'}
        </Button>
      </Card>
    </div>
  );
}
