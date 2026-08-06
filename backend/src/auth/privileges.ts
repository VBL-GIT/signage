import { Response, NextFunction } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '../types/domain';

/** The full catalog of toggleable privileges (shown in the role builder). */
export const PRIVILEGES = [
  { key: 'task.create', label: 'Create tasks' },
  { key: 'task.assign', label: 'Assign & reassign tasks' },
  { key: 'task.approve', label: 'Approve / reject recees' },
  { key: 'store.manage', label: 'Create & manage stores' },
  { key: 'artwork.manage', label: 'Create & manage artworks' },
  { key: 'vendor.manage', label: 'Create & manage vendors' },
  { key: 'vendor.status', label: 'Activate / deactivate vendors' },
  { key: 'user.manage', label: 'Create accounts / bulk users' },
  { key: 'user.status', label: 'Activate / deactivate users' },
  { key: 'role.manage', label: 'Create & manage roles' },
] as const;

export type Privilege = (typeof PRIVILEGES)[number]['key'];
export const ALL_PRIVILEGES: Privilege[] = PRIVILEGES.map((p) => p.key);

// Fixed defaults for the non-customisable base roles.
const DEFAULTS: Record<UserRole, Privilege[]> = {
  rjcorp_admin: ALL_PRIVILEGES,                                  // superuser
  vendor_admin: ['task.assign', 'user.manage', 'user.status'],   // within own vendor (enforced in controllers)
  vendor_user: [],
  rjcorp_user: [],                                               // comes from the assigned custom role
  employee: [],                                                  // mobile only
};

/** True for head-office accounts that see/act across all vendors. */
export function isHeadOffice(role: UserRole): boolean {
  return role === 'rjcorp_admin' || role === 'rjcorp_user';
}

/** Resolve a user's effective privilege set. rjcorp_user pulls from its custom role. */
export async function getEffectivePrivileges(user: { id: string; role: UserRole }): Promise<Privilege[]> {
  if (user.role === 'rjcorp_admin') return ALL_PRIVILEGES;
  if (user.role === 'rjcorp_user') {
    const { rows } = await pool.query(
      `SELECT r.privileges FROM users u
       LEFT JOIN roles r ON r.id = u.custom_role_id
       WHERE u.id = $1`,
      [user.id]
    );
    return (rows[0]?.privileges ?? []) as Privilege[];
  }
  return DEFAULTS[user.role] ?? [];
}

/** Route guard: require a specific privilege. */
export function requirePrivilege(priv: Privilege) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) { res.status(401).json({ error: 'Unauthenticated' }); return; }
    const privs = await getEffectivePrivileges(req.user);
    if (!privs.includes(priv)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
