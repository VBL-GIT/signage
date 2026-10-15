import { useEffect, useState } from 'react';
import { getAccessOverview, type AccessOverview, type AccessAccount } from '../api';
import { useAuth } from '../store/auth';
import { Card, Spinner, ErrorBanner } from '../components/ui';
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

  useEffect(() => {
    if (role !== 'rjcorp_admin') return;
    getAccessOverview().then(setData).catch((e) => setErr(apiError(e)));
  }, [role]);

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
        Visible to RJCorp admins only. This shows exactly what the server enforces. To change a custom role, use Manage → Roles.
        Every change made by an admin is recorded with their email in the <b>Audit Log</b>.
      </p>

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
                  {p.admin_only && <span className="badge origin-u" style={{ marginLeft: 6 }}>RJ admin only</span>}
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
          the "RJ admin only" items. Vendor roles are further limited to their own vendor's data by the server.
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
          <Accounts users={r.users} showRole={r.key === 'rjcorp_user'} />
        </Card>
      ))}

      {data.custom_roles.length > 0 && <h2 style={{ marginTop: 20 }}>Custom roles</h2>}
      {data.custom_roles.map((c) => (
        <Card key={c.id}>
          <h3 style={{ margin: 0 }}>{c.name} <span className="muted">· {c.users.length} account{c.users.length === 1 ? '' : 's'}</span></h3>
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

function Accounts({ users, showRole }: { users: AccessAccount[]; showRole?: boolean }) {
  if (users.length === 0) return <div className="muted">No accounts in this role.</div>;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {users.map((u) => (
        <div key={u.id} className="meta" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ color: 'var(--text)' }}>{u.name}</b>
          <span>{u.email}</span>
          {u.vendor && <span>· {u.vendor}</span>}
          {showRole && <span>· {u.custom_role ?? 'no custom role'}</span>}
          {!u.active && <span className="badge cancelled">Inactive</span>}
        </div>
      ))}
    </div>
  );
}
