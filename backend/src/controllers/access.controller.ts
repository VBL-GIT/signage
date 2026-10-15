import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { PRIVILEGES, RJCORP_ADMIN_ONLY, ALL_PRIVILEGES, baseRolePrivileges, capPrivileges, type Privilege } from '../auth/privileges';

/**
 * Roles & permissions overview — RJ admin only (enforced by the route).
 * Read-only: roles are still edited under Manage. Everything is derived from the
 * same functions the guards use, so what this page shows is what is enforced.
 */
const BASE_ROLES = [
  {
    key: 'rjcorp_admin', label: 'RJCorp Admin', scope: 'All vendors',
    description: 'Head-office superuser. The only role that can see this page and the audit log, and the only one that can manage roles, accounts and passwords across all vendors.',
  },
  {
    key: 'rjcorp_user', label: 'RJCorp User', scope: 'All vendors',
    description: 'Head-office staff. Permissions come from the custom role assigned to each account, and can never include account or role administration.',
  },
  {
    key: 'vendor_admin', label: 'Vendor Admin', scope: 'Own vendor only',
    description: 'Runs one vendor: assigns and cancels that vendor\'s tasks, manages and sets passwords for that vendor\'s own staff. Cannot touch other vendors or head-office accounts.',
  },
  {
    key: 'vendor_user', label: 'Vendor User', scope: 'Own vendor only',
    description: 'Read-only view of that vendor\'s tasks, stores and reports. No management privileges.',
  },
  {
    key: 'employee', label: 'Employee', scope: 'Own tasks (mobile app)',
    description: 'Field staff using the mobile app only: sees their own tasks, submits recees and installations, and can start an unassigned recee or installation. No web console access.',
  },
] as const;

export async function accessOverview(_req: AuthRequest, res: Response) {
  const [{ rows: users }, { rows: customRoles }] = await Promise.all([
    pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.custom_role_id, v.name AS vendor_name
         FROM users u LEFT JOIN vendors v ON v.id = u.vendor_id
        ORDER BY u.role, u.name`
    ),
    pool.query('SELECT id, name, privileges FROM roles ORDER BY name'),
  ]);

  const roleName = new Map<string, string>(customRoles.map((r) => [r.id, r.name]));
  const privsOfCustom = new Map<string, Privilege[]>(
    customRoles.map((r) => [r.id, capPrivileges('rjcorp_user', (r.privileges ?? []) as Privilege[])])
  );

  const effective = (u: { role: string; custom_role_id: string | null }): Privilege[] =>
    u.role === 'rjcorp_user'
      ? (u.custom_role_id ? privsOfCustom.get(u.custom_role_id) ?? [] : [])
      : baseRolePrivileges(u.role as any);

  const usersOf = (role: string) => users.filter((u) => u.role === role).map((u) => ({
    id: u.id, name: u.name, email: u.email, active: u.is_active, vendor: u.vendor_name,
    custom_role: u.custom_role_id ? roleName.get(u.custom_role_id) ?? null : null,
    privileges: effective(u),
  }));

  res.json({
    privileges: PRIVILEGES.map((p) => ({ ...p, admin_only: RJCORP_ADMIN_ONLY.includes(p.key) })),
    base_roles: BASE_ROLES.map((r) => ({
      ...r,
      // rjcorp_user has no fixed set: it varies by custom role (see custom_roles / per-user lists).
      privileges: r.key === 'rjcorp_user' ? null : baseRolePrivileges(r.key as any),
      users: usersOf(r.key),
    })),
    custom_roles: customRoles.map((r) => ({
      id: r.id, name: r.name,
      privileges: privsOfCustom.get(r.id) ?? [],
      users: users.filter((u) => u.custom_role_id === r.id).map((u) => ({ id: u.id, name: u.name, email: u.email, active: u.is_active })),
    })),
    all_privileges: ALL_PRIVILEGES,
  });
}
