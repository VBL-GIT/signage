import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { canAdministerPassword, setAccountPassword } from '../services/users.service';
import { generateTemporaryPassword } from '../services/password';

// Requests the viewer may see: every account for an RJ admin, only their own
// vendor's non-head-office staff for a vendor admin (same rule as passwords).
function scopeClause(req: AuthRequest, params: unknown[]): string {
  if (req.user!.role === 'rjcorp_admin') return '';
  params.push(req.user!.vendor_id);
  return `AND u.vendor_id = $${params.length} AND u.role NOT IN ('rjcorp_admin', 'rjcorp_user')`;
}

export async function listPasswordRequests(req: AuthRequest, res: Response) {
  const status = req.query.status === 'all' ? null : 'pending';
  const params: unknown[] = [];
  const scope = scopeClause(req, params);
  const statusSql = status ? `AND pr.status = 'pending'` : '';
  const { rows } = await pool.query(
    `SELECT pr.id, pr.status, pr.created_at, pr.resolved_at, pr.entered_name, pr.entered_mobile,
            u.id AS user_id, u.name, u.email, u.role, u.phone AS mobile, v.name AS vendor_name,
            rb.name AS resolved_by_name
       FROM password_requests pr
       JOIN users u ON u.id = pr.user_id
       LEFT JOIN vendors v ON v.id = u.vendor_id
       LEFT JOIN users rb ON rb.id = pr.resolved_by
      WHERE true ${statusSql} ${scope}
      ORDER BY (pr.status = 'pending') DESC, pr.created_at DESC
      LIMIT 200`,
    params
  );
  res.json(rows);
}

export async function pendingPasswordRequestCount(req: AuthRequest, res: Response) {
  const params: unknown[] = [];
  const scope = scopeClause(req, params);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM password_requests pr JOIN users u ON u.id = pr.user_id
      WHERE pr.status = 'pending' ${scope}`,
    params
  );
  res.json({ count: rows[0].n });
}

async function loadScoped(req: AuthRequest, res: Response) {
  const { rows } = await pool.query(
    `SELECT pr.id, pr.status, u.id AS user_id, u.role, u.vendor_id
       FROM password_requests pr JOIN users u ON u.id = pr.user_id WHERE pr.id = $1`,
    [req.params.id]
  );
  const pr = rows[0];
  if (!pr) { res.status(404).json({ error: 'Request not found' }); return null; }
  if (!canAdministerPassword(req.user!, pr)) { res.status(403).json({ error: 'You do not have permission for this request' }); return null; }
  if (pr.status !== 'pending') { res.status(409).json({ error: 'This request has already been handled' }); return null; }
  return pr;
}

/** Sets the requester's new password (typed, or generated) and closes the request. */
export async function resolvePasswordRequest(req: AuthRequest, res: Response) {
  const pr = await loadScoped(req, res);
  if (!pr) return;
  const password = (req.body as { password?: string }).password || generateTemporaryPassword();
  await setAccountPassword(pr.user_id, password);
  await pool.query(
    `UPDATE password_requests SET status = 'resolved', resolved_at = NOW(), resolved_by = $2 WHERE id = $1`,
    [pr.id, req.user!.id]
  );
  // Shown to the admin once so they can pass it on to the user.
  res.json({ user_id: pr.user_id, password });
}

export async function dismissPasswordRequest(req: AuthRequest, res: Response) {
  const pr = await loadScoped(req, res);
  if (!pr) return;
  await pool.query(
    `UPDATE password_requests SET status = 'dismissed', resolved_at = NOW(), resolved_by = $2 WHERE id = $1`,
    [pr.id, req.user!.id]
  );
  res.json({ ok: true });
}
