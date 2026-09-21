import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import {
  resolveUserScope, insertUser, duplicateEmailMessage, findUserByEmail,
} from '../services/users.service';
import { verifyEmailDeliverable, sendCredentialsEmail } from '../services/email.service';
import { generateTemporaryPassword } from '../services/password';
import { isVaultEnabled, openPassword } from '../services/credential-vault';
import { validateEmail } from '../services/validation';
import { getEffectivePrivileges, isHeadOffice } from '../auth/privileges';

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
  if (email !== undefined) {
    // Same syntax + typo rules as creation, so an edit can't smuggle in an
    // address that creation would have rejected.
    const syntax = validateEmail(email, 'email');
    if (!syntax.ok) { res.status(400).json({ error: syntax.reason }); return; }
    const clash = await findUserByEmail(syntax.value);
    if (clash && clash.id !== target.id) {
      res.status(409).json({ error: duplicateEmailMessage(clash.vendor_id, target.vendor_id) });
      return;
    }
    add('email', syntax.value);
  }
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
      res.status(409).json({ error: duplicateEmailMessage(null, target.vendor_id) }); return;
    }
    throw e;
  }
}

export async function listBrands(_req: AuthRequest, res: Response) {
  const { rows } = await pool.query('SELECT * FROM brands ORDER BY name');
  res.json(rows);
}

// Brands have no UID (unlike vendors/artworks) — they're a simple reference list.
// Names are unique case-insensitively: the task importer resolves brand_name by
// lower(name), so a duplicate would make "which brand?" ambiguous on import.
export async function createBrand(req: AuthRequest, res: Response) {
  const { name } = req.body as { name: string };
  const clean = name.trim();
  const { rows: dupe } = await pool.query('SELECT id FROM brands WHERE lower(name) = lower($1)', [clean]);
  if (dupe.length) { res.status(409).json({ error: `A brand named "${clean}" already exists` }); return; }
  try {
    const { rows } = await pool.query('INSERT INTO brands (name) VALUES ($1) RETURNING *', [clean]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      res.status(409).json({ error: `A brand named "${clean}" already exists` }); return;
    }
    throw e;
  }
}

export async function listBoardingSizes(_req: AuthRequest, res: Response) {
  const { rows } = await pool.query(
    'SELECT * FROM standard_boarding_sizes WHERE is_active = true ORDER BY width_cm'
  );
  res.json(rows);
}

/**
 * List accounts, scoped to what the caller's level covers.
 *
 * Three rules, in order of how much they hide:
 *   - vendor_admin / vendor_user see only their own vendor's accounts.
 *   - a caller who cannot administer accounts (no user.manage, no user.status)
 *     sees only field employees. That is everything the assignment pickers
 *     need, and it is what keeps an rjcorp_user holding an operational custom
 *     role out of other people's account details — including head office's.
 *   - rjcorp_admin holds both privileges and no vendor scope, so it sees every
 *     account at every level, which is the point of it being the top level.
 */
export async function listUsers(req: AuthRequest, res: Response) {
  const { role } = req.query;
  const clauses: string[] = [];
  const params: unknown[] = [];

  const privs = await getEffectivePrivileges(req.user!);
  const administersAccounts = privs.includes('user.manage') || privs.includes('user.status');
  if (!administersAccounts) clauses.push(`u.role = 'employee'`);

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

/**
 * Create an account.
 *
 * The password is ALWAYS system-generated — the creating admin cannot choose or
 * see it. The plaintext exists only in this function's scope: it is bcrypt-hashed
 * by insertUser for storage and handed to the credentials email, then discarded.
 * It is never logged and never included in the response.
 */
export async function createUser(req: AuthRequest, res: Response) {
  const { first_name, last_name, email, role, mobile, vendor_id, custom_role_id,
          password: adminPassword } = req.body;
  let scope;
  try {
    scope = resolveUserScope(req.user!, role, vendor_id ?? null);
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
    return;
  }
  // Syntax + common-typo check (always on), then deliverability (no-op unless
  // EMAIL_VERIFY_MX is enabled). Same rules the bulk importer applies.
  const syntax = validateEmail(email, 'email');
  if (!syntax.ok) { res.status(400).json({ error: syntax.reason }); return; }
  const cleanEmail = syntax.value;

  const check = await verifyEmailDeliverable(cleanEmail);
  if (!check.ok) { res.status(400).json({ error: check.reason || 'Invalid email' }); return; }

  // Friendly duplicate message before hitting the unique index. The index is
  // still the backstop below, for the check-then-insert race.
  const clash = await findUserByEmail(cleanEmail);
  if (clash) {
    res.status(409).json({ error: duplicateEmailMessage(clash.vendor_id, scope.vendor_id) });
    return;
  }

  // Normally strong and cryptographically-random, then emailed to its owner.
  //
  // INTERIM: while outbound email is undeliverable an admin may supply the
  // password instead — otherwise a new account cannot be reached at all, since
  // Forgot Password needs email too and there is no change-password screen.
  // Supplied or generated, the plaintext is held in memory only long enough to
  // be hashed (and emailed, where delivery works): it is never logged, never
  // returned in the response, and never stored unhashed.
  const adminSetPassword = typeof adminPassword === 'string' && adminPassword.length > 0;
  const password = adminSetPassword ? adminPassword : generateTemporaryPassword();

  try {
    const created = await insertUser({
      first_name, last_name, email: cleanEmail, password,
      role: scope.role, vendor_id: scope.vendor_id, mobile,
    });
    // A custom role only applies to rjcorp_user accounts.
    if (scope.role === 'rjcorp_user' && custom_role_id) {
      await pool.query('UPDATE users SET custom_role_id = $1 WHERE id = $2', [custom_role_id, created.id]);
      created.custom_role_id = custom_role_id;
    }
    // Email still goes out when it can — it is the only channel for a
    // generated password, and confirms an admin-set one to its owner.
    // Best-effort: a failed send never fails account creation.
    const email_sent = await sendCredentialsEmail({
      to: cleanEmail, name: created.name, email: cleanEmail, password,
      role: scope.role, uid: created.uid,
    });
    // `created` comes from insertUser's RETURNING list, which does not include
    // password_hash — and the plaintext is deliberately absent here.
    //
    // password_set_by_admin lets the console tell the two cases apart: an
    // undelivered generated password strands the account, whereas an
    // undelivered admin-set one does not, because the admin already knows it.
    res.status(201).json({ user: created, email_sent, password_set_by_admin: adminSetPassword });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      // Race backstop — the pre-check above handles the common case.
      res.status(409).json({ error: duplicateEmailMessage(null, scope.vendor_id) });
      return;
    }
    throw e;
  }
}

/**
 * Reveal an account's current password to an authorised admin.
 *
 * Visibility is hierarchical, as asked:
 *   rjcorp_admin  — any account
 *   vendor_admin  — only accounts belonging to their own vendor
 *   anyone else   — refused
 *
 * rjcorp_user is deliberately NOT included. It is a general head-office role
 * that can be granted through custom roles, and reading every password in the
 * system is not something a privilege flag should be able to hand out
 * incidentally.
 *
 * Answers `null` rather than an error when a password simply is not available:
 * accounts created before this feature, or created while no encryption key was
 * configured, have nothing stored, and a bcrypt hash cannot be reversed.
 *
 * Deliberately its own endpoint rather than a field on the user list — a
 * password is fetched only when someone explicitly asks for that one account,
 * so it never rides along in a payload that merely renders a table.
 */
export async function getUserPassword(req: AuthRequest, res: Response) {
  const viewer = req.user!;
  const { id } = req.params;

  const { rows } = await pool.query(
    'SELECT id, name, email, role, vendor_id, password_encrypted FROM users WHERE id = $1',
    [id]
  );
  const target = rows[0];
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }

  const isRjcorpAdmin = viewer.role === 'rjcorp_admin';
  const isOwnVendorAdmin =
    viewer.role === 'vendor_admin' &&
    !!viewer.vendor_id &&
    target.vendor_id === viewer.vendor_id;

  if (!isRjcorpAdmin && !isOwnVendorAdmin) {
    res.status(403).json({ error: 'You do not have permission to view this password' });
    return;
  }

  // A vendor admin may read their own staff, not another vendor admin's peers
  // at head office who happen to share a vendor_id of null.
  if (isOwnVendorAdmin && (target.role === 'rjcorp_admin' || target.role === 'rjcorp_user')) {
    res.status(403).json({ error: 'You do not have permission to view this password' });
    return;
  }

  const password = openPassword(target.password_encrypted);
  res.json({
    user_id: target.id,
    email: target.email,
    password,
    available: password !== null,
    reason: password === null
      ? (isVaultEnabled()
          ? 'This account\'s password was set before it could be stored for viewing. Reset it to make one visible.'
          : 'Password viewing is not configured on this server (CREDENTIAL_ENC_KEY is unset).')
      : null,
  });
}
