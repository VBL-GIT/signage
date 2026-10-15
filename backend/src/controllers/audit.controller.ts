import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Who changed what, newest first. RJ admin only (enforced by the route). */
export async function listAudit(req: AuthRequest, res: Response) {
  const conds: string[] = [];
  const params: unknown[] = [];
  const val = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string).trim() : '');

  if (val('actor')) { params.push(val('actor').toLowerCase()); conds.push(`lower(actor_email) = $${params.length}`); }
  if (val('actor_role')) { params.push(val('actor_role')); conds.push(`actor_role = $${params.length}`); }
  if (val('entity_type')) { params.push(val('entity_type')); conds.push(`entity_type = $${params.length}`); }
  for (const [k, op] of [['date_from', '>='], ['date_to', '<=']] as const) {
    if (!val(k)) continue;
    if (!DATE_RE.test(val(k)) || Number.isNaN(Date.parse(val(k)))) { res.status(400).json({ error: `${k} must be YYYY-MM-DD` }); return; }
    params.push(val(k));
    conds.push(`(created_at AT TIME ZONE 'Asia/Kolkata')::date ${op} $${params.length}::date`);
  }
  if (val('q')) {
    params.push(`%${val('q').replace(/[%_\\]/g, '\\$&')}%`);
    const n = params.length;
    conds.push(`(description ILIKE $${n} OR entity_label ILIKE $${n} OR actor_email ILIKE $${n} OR action ILIKE $${n})`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const pageSize = Math.min(Math.max(parseInt(String(req.query.page_size ?? ''), 10) || 50, 1), 200);
  const page = Math.max(parseInt(String(req.query.page ?? ''), 10) || 1, 1);

  const [{ rows: count }, { rows }] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM audit_log ${where}`, params),
    pool.query(
      `SELECT id, created_at, actor_email, actor_name, actor_role, action, description, entity_type, entity_id, entity_label, details
         FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
  ]);
  res.json({ page, page_size: pageSize, total: count[0].n, rows });
}

/** Distinct accounts that have made changes, for the filter dropdown. */
export async function listAuditActors(_req: AuthRequest, res: Response) {
  const { rows } = await pool.query(
    `SELECT actor_email, MAX(actor_name) AS actor_name, MAX(actor_role) AS actor_role, COUNT(*)::int AS changes,
            MAX(created_at) AS last_change
       FROM audit_log GROUP BY actor_email ORDER BY actor_email`
  );
  res.json(rows);
}
