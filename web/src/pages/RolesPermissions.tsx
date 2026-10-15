import { useEffect, useState } from 'react';
import { getAccessOverview, getPrivilegeCatalog, createRole, updateRole, deleteRole, setUserRole, type AccessOverview, type AccessAccount } from '../api';
import { useAuth } from '../store/auth';
import { Card, Spinner, ErrorBanner, Button } from '../components/ui';
import { apiError } from '../api/client';

/**
 * Every role, what it can do, and who holds it. Read-only and RJ-admin-only (the
 * server enforces this; the nav link and this check are only conveniences). Roles
 * themselves are still edited under Manage.
 */
export function RolesPermissions() {
  const role = useAuth().user?.role;
  const [data, setData] = useState<AccessOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => getAccessOverview().then(setData).catch((e) => setErr(apiError(e)));
  useEffect(() => {
    if (role !== 'rjcorp_admin') return;
    reload();
  }, [role]);

  function startNew() { setEditing(null); setName(''); setPicked(new Set()); }
  function startEdit(id: string, n: string, p: string[]) { setEditing(id); setName(n); setPicked(new Set(p)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function toggle(k: string) { setPicked((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; }); }
  async function save() {
    setErr(null);
    if (!name.trim()) { setErr('Role name is required'); return; }
    setBusy(true);
    try {
      const body = { name: name.trim(), privileges: [...picked] as any };
      if (editing) await updateRole(editing, body); else await createRole(body);
      startNew(); await reload();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }
  async function remove(id: string, n: string, holders: number) {
    if (!window.confirm(`Delete the role "${n}"?${holders ? ` ${holders} account(s) will lose it.` : ''} This cannot be undone.`)) return;
    setErr(null);
    try { await deleteRole(id); if (editing === id) startNew(); await reload(); } catch (e) { setErr(apiError(e)); }
  }
  async function assign(userId: string, roleId: string) {
    setErr(null);
    try { await setUserRole(userId, roleId || null); await reload(); } catch (e) { setErr(apiError(e)); }
  }

  if (role !== 'rjcorp_admin') return <p>This page is only available to RJCorp admins.</p>;
  if (err) return <ErrorBanner msg={err} />;
  if (!data) return <Spinner />;

  // Matrix columns: each base role with a fixed set, then every custom role.
  const columns: { key: string; label: string; sub?: string; has: (p: string) => boolean | null }[] = [
    ...data.base_roles.filter((r) => r.privileges).map((r) => ({
      key: r.key, label: r.label, sub: r.scope, has: (p: string) => r.privileges!.includes(p),
    })),
    ...data.custom_roles.map((c) => ({
      key: c.id, label: c.name, sub: 'Custom role (for RJCorp Users)', has: (p: string) => c.privileges.includes(p),
    })),
  ];

  return (
    <div>
      <h1>Roles &amp; Permissions</h1>
      <p className="meta">
        Visible to RJCorp admins only. This shows exactly what the server enforces. Create and edit custom roles below, and assign them to RJCorp User accounts.
        Every change made by an admin is recorded with their email in the <b>Audit Log</b>.
      </p>

      <Card>
        <h3>{editing ? 'Edit custom role' : 'Create a custom role'}</h3>
        <ErrorBanner msg={err} />
        <label>Role name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Regional Coordinator" />
        <label>Privileges</label>
        <div style={{ display: 'grid', gap: 6 }}>
          {data.privileges.map((p) => (
            <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, margin: 0, opacity: p.admin_only ? 0.55 : 1 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={!p.admin_only && picked.has(p.key)} disabled={p.admin_only} onChange={() => toggle(p.key)} />
              {p.label}{p.admin_only && <span className="meta">Not available to custom roles</span>}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button onClick={save} disabled={busy}>{editing ? 'Save changes' : 'Create role'}</Button>
          {editing && <Button variant="secondary" onClick={startNew}>Cancel</Button>}
        </div>
      </Card>

      <Card style={{ overflowX: 'auto' }}>
        <h3>Permission matrix</h3>
        <table className="table" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Permission</th>
              {columns.map((c) => (
                <th key={c.key} style={{ textAlign: 'center' }}>{c.label}<div className="meta" style={{ fontWeight: 400 }}>{c.sub}</div></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.privileges.map((p) => (
              <tr key={p.key}>
                <td>
                  {p.label}
                  {p.admin_only && <span className="badge origin-u" style={{ marginLeft: 6 }} title="Cannot be given to a custom role (RJCorp User). RJCorp Admin has it; a Vendor Admin has it only for their own vendor's staff.">Not for custom roles</span>}
                  <div className="meta">{p.key}</div>
                </td>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: 'center', color: c.has(p.key) ? 'var(--success)' : 'var(--muted)', fontWeight: 700 }}>
                    {c.has(p.key) ? '✓' : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="meta" style={{ marginTop: 8 }}>
          RJCorp User permissions are not fixed: each account gets those of its custom role (columns on the right), and can never include
          the "Not for custom roles" items. A Vendor Admin keeps account management too, but only for their own vendor's staff. Vendor roles are further limited to their own vendor's data by the server.
        </div>
      </Card>

      <h2 style={{ marginTop: 20 }}>Roles and their accounts</h2>
      {data.base_roles.map((r) => (
        <Card key={r.key}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{r.label}</h3>
            <span className="badge origin-a">{r.scope}</span>
            <span className="muted">{r.users.length} account{r.users.length === 1 ? '' : 's'}</span>
          </div>
          <p className="meta" style={{ margin: '6px 0 10px' }}>{r.description}</p>
          {r.privileges && (
            <div className="chips" style={{ marginBottom: 10 }}>
              {r.privileges.length === 0
                ? <span className="muted">No management privileges</span>
                : r.privileges.map((p) => <span key={p} className="badge speed">{data.privileges.find((x) => x.key === p)?.label ?? p}</span>)}
            </div>
          )}
          <Accounts users={r.users} showRole={r.key === 'rjcorp_user'} roles={r.key === 'rjcorp_user' ? data.custom_roles : undefined} onAssign={assign} />
        </Card>
      ))}

      {data.custom_roles.length > 0 && <h2 style={{ marginTop: 20 }}>Custom roles</h2>}
      {data.custom_roles.map((c) => (
        <Card key={c.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ margin: 0 }}>{c.name} <span className="muted">· {c.users.length} account{c.users.length === 1 ? '' : 's'}</span></h3><div style={{ display: 'flex', gap: 6 }}><Button variant="secondary" onClick={() => startEdit(c.id, c.name, c.privileges)}>Edit</Button><Button variant="secondary" onClick={() => remove(c.id, c.name, c.users.length)}>Delete</Button></div></div>
          <div className="chips" style={{ margin: '8px 0' }}>
            {c.privileges.length === 0
              ? <span className="muted">No privileges</span>
              : c.privileges.map((p) => <span key={p} className="badge speed">{data.privileges.find((x) => x.key === p)?.label ?? p}</span>)}
          </div>
          <Accounts users={c.users} />
        </Card>
      ))}
    </div>
  );
}

function Accounts({ users, showRole, roles, onAssign }: { users: AccessAccount[]; showRole?: boolean; roles?: { id: string; name: string }[]; onAssign?: (userId: string, roleId: string) => void }) {
  if (users.length === 0) return <div className="muted">No accounts in this role.</div>;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {users.map((u) => (
        <div key={u.id} className="meta" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ color: 'var(--text)' }}>{u.name}</b>
          <span>{u.email}</span>
          {u.vendor && <span>· {u.vendor}</span>}
          {showRole && !roles && <span>· {u.custom_role ?? 'no custom role'}</span>}
          {roles && onAssign && (
            <select style={{ width: 'auto', padding: '2px 6px' }} value={roles.find((r) => r.name === u.custom_role)?.id ?? ''} onChange={(e) => onAssign(u.id, e.target.value)}>
              <option value="">No custom role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          {!u.active && <span className="badge cancelled">Inactive</span>}
        </div>
      ))}
    </div>
  );
}
