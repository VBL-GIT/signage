import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTasks, getUsers, getVendors, assignBulk, type BulkAssignResult } from '../api';
import type { Task, User, Vendor } from '../types';
import { useAuth } from '../store/auth';
import { Button, Card, Spinner, ErrorBanner } from '../components/ui';
import { apiError } from '../api/client';

type AssignFilter = 'all' | 'unassigned' | 'assigned';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  recee_submitted: 'Recee submitted',
  recee_approved: 'Recee approved',
  recee_rejected: 'Recee rejected',
  installed: 'Installed',
  completed: 'Completed',
};

export function Assignments() {
  const role = useAuth().user?.role;
  const isHeadOffice = role === 'rjcorp_admin' || role === 'rjcorp_user';

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [employees, setEmployees] = useState<User[]>([]);
  const [vendorName, setVendorName] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [empQuery, setEmpQuery] = useState('');
  const [selectedEmp, setSelectedEmp] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<BulkAssignResult | null>(null);

  // filters
  const [query, setQuery] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [assignState, setAssignState] = useState<AssignFilter>('unassigned');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');

  // Switching the assigned/unassigned view is a context change — drop the selection.
  function switchTab(next: AssignFilter) { setAssignState(next); setSel(new Set()); }

  async function load() {
    const [t, emps, vendors] = await Promise.all([
      getTasks(),
      getUsers({ role: 'employee' }),
      isHeadOffice ? getVendors() : Promise.resolve([] as Vendor[]),
    ]);
    // Completed tasks can't be reassigned — leave them out of the queue.
    setTasks(t.filter((x) => x.status !== 'completed'));
    setEmployees(emps);
    setVendorName(Object.fromEntries(vendors.map((v) => [v.id, v.name])));
  }
  useEffect(() => { load().catch((e) => { setErr(apiError(e)); setTasks([]); }); }, [isHeadOffice]);

  // Vendors that actually appear in the queue (for the dropdown).
  const vendorsInQueue = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks ?? []) {
      if (t.vendor_id && !m.has(t.vendor_id)) {
        m.set(t.vendor_id, `${t.vendor_name ?? 'Vendor'}${t.vendor_uid ? ` (${t.vendor_uid})` : ''}`);
      }
    }
    return [...m.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = (tasks ?? []).filter((t) => {
      if (vendorId && t.vendor_id !== vendorId) return false;
      if (assignState === 'unassigned' && t.employee_id) return false;
      if (assignState === 'assigned' && !t.employee_id) return false;
      if (!q) return true;
      return [t.store_name, t.store_uid, t.vendor_name, t.vendor_uid, t.employee_name, t.store_pincode]
        .some((v) => (v ?? '').toString().toLowerCase().includes(q));
    });
    list = [...list].sort((a, b) => {
      const da = new Date(a.created_at).getTime(), db = new Date(b.created_at).getTime();
      return sort === 'oldest' ? da - db : db - da;
    });
    return list;
  }, [tasks, query, vendorId, assignState, sort]);

  const counts = useMemo(() => {
    const c = { all: 0, unassigned: 0, assigned: 0 };
    for (const t of tasks ?? []) {
      if (vendorId && t.vendor_id !== vendorId) continue;
      c.all++;
      if (t.employee_id) c.assigned++; else c.unassigned++;
    }
    return c;
  }, [tasks, vendorId]);

  const allIds = useMemo(() => shown.map((t) => t.id), [shown]);
  const allSelected = allIds.length > 0 && allIds.every((id) => sel.has(id));

  function toggle(id: string) {
    setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() { setSel(allSelected ? new Set() : new Set(allIds)); }
  function openPicker() { setErr(null); setResult(null); setEmpQuery(''); setSelectedEmp(null); setPicking(true); }

  // Employee combo: vendor admins already receive a vendor-scoped list.
  const empShown = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q) ||
      (e.uid ?? '').toLowerCase().includes(q));
  }, [employees, empQuery]);

  async function submit() {
    setErr(null);
    const task_ids = [...sel];
    if (!task_ids.length) { setErr('Select at least one task'); return; }
    if (!selectedEmp) { setErr('Search and select an employee'); return; }
    setBusy(true);
    try {
      const res = await assignBulk({ task_ids, employee_id: selectedEmp.id });
      setResult(res);
      setPicking(false);
      setSel(new Set());
      await load();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  if (!tasks) return <Spinner />;

  return (
    <div>
      <h1>Bulk Assignment</h1>
      <p className="meta">Assign or reassign tasks to a field employee in bulk. Select tasks, then choose who they go to. Completed tasks aren't shown.</p>

      <ErrorBanner msg={err} />
      {result && (
        <div className="banner-ok" style={{ marginBottom: 12 }}>
          ✓ {result.assigned} assigned
          {result.failed.length > 0 && <> · {result.failed.length} skipped</>}
          {result.failed.map((f) => <div key={f.task_id} className="meta">Skipped {f.task_id.slice(0, 8)}…: {f.reason}</div>)}
        </div>
      )}

      {tasks.length === 0 ? (
        <p className="meta">No open tasks to assign right now.</p>
      ) : (
        <>
          <div className="tabs">
            <div className={`tab ${assignState === 'unassigned' ? 'on' : ''}`} onClick={() => switchTab('unassigned')}>Unassigned ({counts.unassigned})</div>
            <div className={`tab ${assignState === 'assigned' ? 'on' : ''}`} onClick={() => switchTab('assigned')}>Assigned ({counts.assigned})</div>
            <div className={`tab ${assignState === 'all' ? 'on' : ''}`} onClick={() => switchTab('all')}>All ({counts.all})</div>
          </div>

          <Card style={{ marginBottom: 12 }}>
            <div className="grid2">
              <div>
                <label>Search</label>
                <input placeholder="Store / vendor name, UID, employee, pincode…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              {isHeadOffice && (
                <div>
                  <label>Vendor</label>
                  <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                    <option value="">All vendors</option>
                    {vendorsInQueue.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label>Sort</label>
                <select value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>
            </div>
            <div className="meta" style={{ marginTop: 8 }}>Showing {shown.length} of {tasks.length}</div>
          </Card>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontWeight: 600 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={allSelected} onChange={toggleAll} />
              Select all{query || vendorId ? ' (filtered)' : ''}
            </label>
            <span className="meta">{sel.size} selected</span>
            <div style={{ flex: 1 }} />
            <Button size="sm" disabled={sel.size === 0} onClick={openPicker}>Assign selected</Button>
          </div>

          {picking && (
            <Card style={{ marginBottom: 12, borderColor: 'var(--brand)' }}>
              <h3>Assign {sel.size} task(s)</h3>
              <p className="meta">
                Search for the employee to assign these tasks to.
                {isHeadOffice && ' Assigning across vendors moves each task to that employee’s vendor.'}
              </p>
              <label>Search employee</label>
              <input
                autoFocus
                placeholder="Type a name, UID or email…"
                value={empQuery}
                onChange={(e) => { setEmpQuery(e.target.value); setSelectedEmp(null); }}
              />
              {selectedEmp && (
                <div className="meta" style={{ marginTop: 8 }}>
                  Selected: <b>{selectedEmp.name}</b>{selectedEmp.uid ? ` · ${selectedEmp.uid}` : ''} ({selectedEmp.email})
                  {isHeadOffice && selectedEmp.vendor_id && vendorName[selectedEmp.vendor_id] ? ` · ${vendorName[selectedEmp.vendor_id]}` : ''}
                </div>
              )}
              <div className="combo-list">
                {empShown.length === 0 && <div className="meta" style={{ padding: 10 }}>No matches</div>}
                {empShown.map((e) => (
                  <div key={e.id} className={`combo-row ${selectedEmp?.id === e.id ? 'sel' : ''}`} onClick={() => setSelectedEmp(e)}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{e.name} {e.uid && <span className="muted">· {e.uid}</span>}</div>
                      <div className="meta">
                        {e.email}
                        {isHeadOffice && e.vendor_id && vendorName[e.vendor_id] ? ` · ${vendorName[e.vendor_id]}` : ''}
                      </div>
                    </div>
                    {selectedEmp?.id === e.id && <span style={{ color: 'var(--brand)', fontWeight: 700 }}>✓</span>}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Button onClick={submit} disabled={busy || !selectedEmp}>{busy ? 'Assigning…' : `Assign to ${selectedEmp ? selectedEmp.name : 'employee'}`}</Button>
                <Button variant="secondary" onClick={() => setPicking(false)}>Cancel</Button>
              </div>
            </Card>
          )}

          {shown.length === 0 ? (
            <p className="meta">No tasks match your filters.</p>
          ) : (
            <div className="row-list">
              {shown.map((t) => (
                <div key={t.id} className="list-row" style={{ cursor: 'default' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 0, flex: 1 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
                    <span>
                      <div style={{ fontWeight: 700 }}>{t.store_name ?? 'No store'}{t.store_uid ? <span className="muted"> · {t.store_uid}</span> : ''}</div>
                      <div className="meta">
                        {t.vendor_name ?? '—'}{t.vendor_uid ? ` (${t.vendor_uid})` : ''}
                        {' · '}{STATUS_LABELS[t.status] ?? t.status}
                        {' · '}{t.employee_name ? <>Assigned: <b>{t.employee_name}</b></> : <span style={{ color: 'var(--danger)' }}>Unassigned</span>}
                      </div>
                    </span>
                  </label>
                  <Link to={`/tasks/${t.id}`} className="meta">View ›</Link>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
