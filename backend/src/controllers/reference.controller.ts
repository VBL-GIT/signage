import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { resolveUserScope, insertUser } from '../services/users.service';
import { verifyEmailDeliverable, sendCredentialsEmail } from '../services/email.service';
import { isHeadOffice } from '../auth/privileges';

// Edit a user's basic details. Head office may edit anyone; a vendor admin may
// edit only employees within their own vendor.
export async function updateUser(req: AuthRequest, res: Response) {
  const { first_name, last_name, email, mobile } = req.body as {
    first_name?: string; last_name?: string; email?: string; mobile?: string;
  };
  const me = req.user!;
  const { rows: t } = await pool.query(
    'SELECT id, role, vendor_id, first_name, last_name FROM users WHERE id = $1', [req.params.id]
  );
  const target = t[0];
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }

  if (me.role === 'vendor_admin') {
    if (target.role !== 'employee' || target.vendor_id !== me.vendor_id) {
      res.status(403).json({ error: 'Vendor admins can only edit employees in their own vendor' }); return;
    }
  } else if (!isHeadOffice(me.role)) {
    res.status(403).json({ error: 'Insufficient permissions' }); return;
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  const newFirst = first_name !== undefined ? first_name.trim() : target.first_name;
  const newLast = last_name !== undefined ? last_name.trim() : target.last_name;
  if (first_name !== undefined) add('first_name', newFirst);
  if (last_name !== undefined) add('last_name', newLast);
  if (first_name !== undefined || last_name !== undefined) add('name', `${newFirst ?? ''} ${newLast ?? ''}`.trim());
  if (email !== undefined) add('email', email.trim().toLowerCase());
  if (mobile !== undefined) add('phone', mobile.trim() || null);
  if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }

  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, first_name, last_name, email, phone, role, vendor_id, uid, is_active, custom_role_id`,
      params
    );
    res.json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'A user with this email already exists' }); return;
    }
    throw e;
  }
}

export async function listBrands(_req: AuthRequest, res: Response) {
  const { rows } = await pool.query('SELECT * FROM brands ORDER BY name');
  res.json(rows);
}

// Brands have no UID (unlike vendors/artworks) — they're a simple reference list.
export async function createBrand(req: AuthRequest, res: Response) {
  const { name } = req.body as { name: string };
  const { rows } = await pool.query(
    'INSERT INTO brands (name) VALUES ($1) RETURNING *',
    [name.trim()]
  );
  res.status(201).json(rows[0]);
}

export async function listBoardingSizes(_req: AuthRequest, res: Response) {
  const { rows } = await pool.query(
    'SELECT * FROM standard_boarding_sizes WHERE is_active = true ORDER BY width_cm'
  );
  res.json(rows);
}

export async function listUsers(req: AuthRequest, res: Response) {
  const { role } = req.query;
  const clauses: string[] = [];
  const params: unknown[] = [];

  // Vendor admins/users only see users within their own vendor
  if (req.user!.role === 'vendor_admin' || req.user!.role === 'vendor_user') {
    params.push(req.user!.vendor_id);
    clauses.push(`u.vendor_id = $${params.length}`);
  }
  if (role) {
    params.push(role);
    clauses.push(`u.role = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.first_name, u.last_name, u.email, u.phone, u.role, u.vendor_id, u.uid,
            u.is_active, u.created_at, u.custom_role_id, r.name AS custom_role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.custom_role_id
     ${where}
     ORDER BY u.name`,
    params
  );
  res.json(rows);
}

// RJCorp head office can toggle any account. Vendor admin can toggle employees in their own vendor only.
export async function setUserActive(req: AuthRequest, res: Response) {
  const { is_active } = req.body as { is_active: boolean };
  const { rows: targetRows } = await pool.query(
    'SELECT id, role, vendor_id FROM users WHERE id = $1', [req.params.id]
  );
  const target = targetRows[0];
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }

  const me = req.user!;
  if (me.role === 'vendor_admin') {
    if (target.role !== 'employee' || target.vendor_id !== me.vendor_id) {
      res.status(403).json({ error: 'Vendor admins can only change employees in their own vendor' });
      return;
    }
  } else if (me.role !== 'rjcorp_admin' && me.role !== 'rjcorp_user') {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }
  if (target.id === me.id) { res.status(400).json({ error: 'You cannot change your own status' }); return; }

  const { rows } = await pool.query(
    'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, name, email, role, vendor_id, uid, is_active',
    [is_active, target.id]
  );
  res.json(rows[0]);
}

/**
 * Hard-delete an employee account — dev/test cleanup only, not for production
 * use. Cascades to that employee's tasks, task_steps, store_assignments,
 * refresh/reset tokens (FK ON DELETE CASCADE), so this destroys real data,
 * not just the account. Restricted to role='employee' so an admin can't
 * accidentally wipe a vendor/head-office account or its history this way.
 * Same scoping as setUserActive: RJCorp head office can delete any employee,
 * a vendor admin only their own vendor's.
 */
export async function deleteEmployee(req: AuthRequest, res: Response) {
  const { rows: targetRows } = await pool.query(
    'SELECT id, role, vendor_id FROM users WHERE id = $1', [req.params.id]
  );
  const target = targetRows[0];
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }
  if (target.role !== 'employee') {
    res.status(400).json({ error: 'Only employee accounts can be deleted' }); return;
  }

  const me = req.user!;
  if (me.role === 'vendor_admin') {
    if (target.vendor_id !== me.vendor_id) {
      res.status(403).json({ error: 'Vendor admins can only delete employees in their own vendor' });
      return;
    }
  } else if (me.role !== 'rjcorp_admin' && me.role !== 'rjcorp_user') {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }

  await pool.query('DELETE FROM users WHERE id = $1', [target.id]);
  res.status(204).end();
}

// Assign / clear a custom role on an rjcorp_user account.
export async function setUserRole(req: AuthRequest, res: Response) {
  const { custom_role_id } = req.body as { custom_role_id: string | null };
  const { rows: t } = await pool.query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
  if (!t[0]) { res.status(404).json({ error: 'User not found' }); return; }
  if (t[0].role !== 'rjcorp_user') {
    res.status(400).json({ error: 'Custom roles can only be assigned to RJCorp user accounts' }); return;
  }
  const { rows } = await pool.query(
    'UPDATE users SET custom_role_id = $1 WHERE id = $2 RETURNING id, name, email, role, custom_role_id',
    [custom_role_id || null, req.params.id]
  );
  res.json(rows[0]);
}

export async function createUser(req: AuthRequest, res: Response) {
  const { first_name, last_name, email, password, role, mobile, vendor_id, custom_role_id } = req.body;
  let scope;
  try {
    scope = resolveUserScope(req.user!, role, vendor_id ?? null);
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
    return;
  }
  // Verify the email is deliverable before we create the account (no-op unless
  // EMAIL_VERIFY_MX is enabled).
  const check = await verifyEmailDeliverable(email);
  if (!check.ok) { res.status(400).json({ error: check.reason || 'Invalid email' }); return; }

  try {
    const created = await insertUser({
      first_name, last_name, email, password,
      role: scope.role, vendor_id: scope.vendor_id, mobile,
    });
    // A custom role only applies to rjcorp_user accounts.
    if (scope.role === 'rjcorp_user' && custom_role_id) {
      await pool.query('UPDATE users SET custom_role_id = $1 WHERE id = $2', [custom_role_id, created.id]);
      created.custom_role_id = custom_role_id;
    }
    // Email the credentials (best-effort; won't fail creation).
    const email_sent = await sendCredentialsEmail({
      to: email, name: created.name, email, password, role: scope.role,
    });
    res.status(201).json({ ...created, email_sent });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'A user with this email already exists' });
      return;
    }
    throw e;
  }
}
