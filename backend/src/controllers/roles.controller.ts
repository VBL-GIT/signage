import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { PRIVILEGES, ALL_PRIVILEGES, RJCORP_ADMIN_ONLY, Privilege } from '../auth/privileges';

/**
 * The catalog carries `admin_only` so the role builder can show which
 * privileges cannot be delegated instead of offering a checkbox that would be
 * stripped on save. Custom roles only ever apply to rjcorp_user accounts, so
 * these are exactly the privileges a custom role can never carry.
 */
export function listPrivilegeCatalog(_req: AuthRequest, res: Response) {
  res.json(PRIVILEGES.map((p) => ({ ...p, admin_only: RJCORP_ADMIN_ONLY.includes(p.key) })));
}

export async function listRoles(_req: AuthRequest, res: Response) {
  const { rows } = await pool.query('SELECT id, name, privileges, created_at FROM roles ORDER BY name');
  res.json(rows);
}

/**
 * Keep only real privileges, and only ones a custom role may carry.
 *
 * A custom role is only ever consulted for an rjcorp_user, so storing an
 * admin-only privilege on one would promise authority that getEffectivePrivileges
 * strips at resolve time. Dropping it here keeps the stored role honest about
 * what it actually grants.
 */
function sanitize(privileges: unknown): Privilege[] {
  if (!Array.isArray(privileges)) return [];
  return privileges.filter(
    (p): p is Privilege =>
      ALL_PRIVILEGES.includes(p as Privilege) && !RJCORP_ADMIN_ONLY.includes(p as Privilege)
  );
}

export async function createRole(req: AuthRequest, res: Response) {
  const { name, privileges } = req.body as { name: string; privileges: string[] };
  try {
    const { rows } = await pool.query(
      'INSERT INTO roles (name, privileges) VALUES ($1, $2) RETURNING id, name, privileges, created_at',
      [name.trim(), sanitize(privileges)]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'A role with this name already exists' });
      return;
    }
    throw e;
  }
}

export async function updateRole(req: AuthRequest, res: Response) {
  const { name, privileges } = req.body as { name?: string; privileges?: string[] };
  const { rows } = await pool.query(
    `UPDATE roles SET
       name = COALESCE($1, name),
       privileges = COALESCE($2, privileges)
     WHERE id = $3 RETURNING id, name, privileges, created_at`,
    [name?.trim() ?? null, privileges ? sanitize(privileges) : null, req.params.id]
  );
  if (!rows[0]) { res.status(404).json({ error: 'Role not found' }); return; }
  res.json(rows[0]);
}
