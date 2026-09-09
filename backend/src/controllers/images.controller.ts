import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';

// Bounded pagination, same clamp pattern as listTasks. Default page size is 20
// to match the Images tab's numbered pager.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

/**
 * Read one column out of a store's source_metadata JSONB by name, ignoring how
 * its key was cased.
 *
 * `source_metadata->>'HOS'` was an exact-key lookup, so a store imported from a
 * sheet spelling the column Hos or "hos" reported no HOS at all — the filter
 * silently matched nothing and the column rendered blank. New imports store
 * their keys all-caps, but stores imported before that do not, so the SQL has
 * to match the same way every other column read does: on spelling alone.
 *
 * `name` is a literal, never user input.
 */
function metaColumn(alias: string, name: string): string {
  return `(SELECT mc.value FROM jsonb_each_text(${alias}.source_metadata) mc
           WHERE upper(mc.key) = '${name}' LIMIT 1)`;
}

/**
 * Browse task photos across recee, post-recee/boarding, and direct (pamphlet)
 * installations — RJCorp head office only. Filters: date range (photo capture
 * time), Customer Code, pincode (matches either the store's pincode or the
 * task's own pincode, since direct/pamphlet tasks are often not tied to a
 * store and instead carry their own area pincode), HOS, and employee.
 */
export async function listImages(req: AuthRequest, res: Response) {
  const { from, to, store_uid, pincode, hos, employee_uid } =
    req.query as Record<string, string | undefined>;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? ''), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(String(req.query.offset ?? ''), 10) || 0, 0);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (from) { conditions.push(`tsp.created_at >= $${idx++}`); params.push(from); }
  if (to) { conditions.push(`tsp.created_at < ($${idx++}::date + interval '1 day')`); params.push(to); }
  // Matches Customer Code first, falling back to the legacy uid so links and
  // saved filters made before the merge keep working.
  if (store_uid) {
    const p = idx++;
    conditions.push(`(lower(s.customer_code) = lower($${p}) OR lower(s.uid) = lower($${p}))`);
    params.push(store_uid);
  }
  if (pincode) {
    const p = idx++;
    conditions.push(`(t.pincode = $${p} OR s.pincode = $${p})`);
    params.push(pincode);
  }
  // HOS lives in the store's source_metadata rather than a column of its own,
  // so it is read out of the JSON. Partial, case-insensitive: operators know
  // the person's name, not the exact stored spelling.
  if (hos) {
    conditions.push(`${metaColumn('s', 'HOS')} ILIKE $${idx++}`);
    params.push(`%${hos}%`);
  }
  // Employee UID, or their name — the UID is on screen but the name is what a
  // person usually has to hand.
  if (employee_uid) {
    const p = idx++;
    conditions.push(`(lower(e.uid) = lower($${p}) OR e.name ILIKE '%' || $${p} || '%')`);
    params.push(employee_uid);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // Same filter params serve both the page of rows and the total count (for
  // the numbered pager) — the count query only adds the two extra joins
  // actually referenced by the WHERE clause (store/pincode filters).
  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT tsp.id, tsp.photo_url, tsp.created_at,
              tsp.area_label, tsp.brand_label, tsp.signage_type,
              sbs.label as boarding_size_label,
              t.id as task_id, t.task_type, t.installation_type, t.pincode as task_pincode,
              COALESCE(s.customer_code, s.uid) as store_uid, s.name as store_name, s.pincode as store_pincode,
              ${metaColumn('s', 'HOS')} as hos,
              e.uid as employee_uid,
              v.name as vendor_name, e.name as employee_name
       FROM task_step_photos tsp
       JOIN task_steps ts ON ts.id = tsp.task_step_id
       JOIN tasks t ON t.id = ts.task_id
       LEFT JOIN stores s ON s.id = t.store_id
       LEFT JOIN vendors v ON v.id = t.vendor_id
       LEFT JOIN users e ON e.id = t.employee_id
       LEFT JOIN standard_boarding_sizes sbs ON sbs.id = tsp.boarding_size_id
       ${where}
       ORDER BY tsp.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    ),
    pool.query(
      // The users join is required, not optional: the employee filter's WHERE
      // clause references `e`, and without it the count query fails while the
      // page query succeeds — a pager that breaks only when filtered.
      `SELECT COUNT(*) as total
       FROM task_step_photos tsp
       JOIN task_steps ts ON ts.id = tsp.task_step_id
       JOIN tasks t ON t.id = ts.task_id
       LEFT JOIN stores s ON s.id = t.store_id
       LEFT JOIN users e ON e.id = t.employee_id
       ${where}`,
      params
    ),
  ]);

  res.json({
    total: Number(countRows[0]?.total ?? 0),
    images: rows.map((r) => ({
      id: r.id,
      photo_url: r.photo_url,
      captured_at: r.created_at,
      task_id: r.task_id,
      task_type: r.task_type,
      installation_type: r.installation_type,
      store_uid: r.store_uid,
      store_name: r.store_name,
      pincode: r.task_pincode ?? r.store_pincode ?? null,
      vendor_name: r.vendor_name,
      employee_name: r.employee_name,
      employee_uid: r.employee_uid,
      hos: r.hos,
      area_label: r.area_label,
      brand_label: r.brand_label,
      signage_type: r.signage_type,
      boarding_size_label: r.boarding_size_label,
    })),
  });
}
