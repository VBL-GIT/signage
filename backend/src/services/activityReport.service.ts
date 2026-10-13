import { pool } from '../config/db';

/**
 * Centralised activity report.
 *
 * COUNTING UNIT: one row = one task record (an "activity"). A recee and the
 * post-recee installation spawned from it are two activities. A task that is
 * rejected, reassigned or resubmitted is still ONE row: those events are columns
 * (Submission Attempts, Times Reassigned), never extra rows, so nothing is
 * double-counted. Cancelled (deleted) tasks are excluded unless asked for.
 */

export const ACTIVITY_ORIGINS = ['ASSIGNED', 'UNASSIGNED'] as const;
export const ACTIVITY_TYPES = ['recee', 'installation_post_recee', 'installation_without_recee', 'pamphlet_distribution'] as const;
export const OUTLET_TYPES = ['speed', 'non_speed', 'not_recorded'] as const;
export const STATUSES = ['pending', 'recee_submitted', 'recee_approved', 'recee_rejected', 'installed', 'completed', 'cancelled'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IST = `'Asia/Kolkata'`;

/** SQL expression for the activity type of task alias `t`. */
export const TYPE_SQL = `CASE
  WHEN t.task_type = 'recee' THEN 'recee'
  WHEN t.installation_type = 'post_recee' THEN 'installation_post_recee'
  WHEN t.installation_type = 'direct_boarding' THEN 'installation_without_recee'
  WHEN t.installation_type = 'direct' THEN 'pamphlet_distribution'
END`;

const OUTLET_SQL = `CASE WHEN s.is_speed IS TRUE THEN 'speed' WHEN s.is_speed IS FALSE THEN 'non_speed' ELSE 'not_recorded' END`;

export const TYPE_LABELS: Record<string, string> = {
  recee: 'Recee',
  installation_post_recee: 'Installation (After Recee)',
  installation_without_recee: 'Installation Without Recee',
  pamphlet_distribution: 'Pamphlet Distribution',
};

export interface ReportUser { id: string; role: string; vendor_id: string | null }

export interface ActivityFilter { where: string; params: unknown[] }

/**
 * Builds the WHERE clause for the report. SECURITY: vendor and employee scope is
 * applied here, from the authenticated user, and overrides anything in the query
 * string — so a vendor user can never widen their view with `?vendor_id=`.
 */
export function buildActivityFilter(
  query: Record<string, unknown>,
  user: ReportUser
): { ok: true; filter: ActivityFilter } | { ok: false; error: string } {
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (n: number) => string, v: unknown) => { params.push(v); conds.push(sql(params.length)); };
  const val = (k: string) => (typeof query[k] === 'string' ? (query[k] as string).trim() : '');

  // ---- mandatory scope (never taken from the request) ----
  if (user.role === 'vendor_admin' || user.role === 'vendor_user') {
    if (!user.vendor_id) return { ok: true, filter: { where: 'false', params: [] } };
    add((n) => `t.vendor_id = $${n}`, user.vendor_id);
  } else if (user.role === 'employee') {
    add((n) => `t.employee_id = $${n}`, user.id);
  } else if (user.role !== 'rjcorp_admin' && user.role !== 'rjcorp_user') {
    return { ok: true, filter: { where: 'false', params: [] } };
  } else if (val('vendor_id')) {
    if (!UUID_RE.test(val('vendor_id'))) return { ok: false, error: 'vendor_id is not valid' };
    add((n) => `t.vendor_id = $${n}`, val('vendor_id'));
  }

  // ---- optional filters ----
  if (val('employee_id')) {
    if (!UUID_RE.test(val('employee_id'))) return { ok: false, error: 'employee_id is not valid' };
    add((n) => `t.employee_id = $${n}`, val('employee_id'));
  }
  const oneOf = (key: string, allowed: readonly string[], sql: (n: number) => string) => {
    if (!val(key)) return null;
    if (!allowed.includes(val(key))) return `${key} must be one of: ${allowed.join(', ')}`;
    add(sql, val(key));
    return null;
  };
  const bad =
    oneOf('origin', ACTIVITY_ORIGINS, (n) => `t.activity_origin = $${n}`) ||
    oneOf('activity_type', ACTIVITY_TYPES, (n) => `(${TYPE_SQL}) = $${n}`) ||
    oneOf('outlet_type', OUTLET_TYPES, (n) => `(${OUTLET_SQL}) = $${n}`) ||
    oneOf('status', STATUSES, (n) => `t.status = $${n}`);
  if (bad) return { ok: false, error: bad };
  if (val('status') !== 'cancelled' && val('status') === '') conds.push(`t.status <> 'cancelled'`);

  for (const [key, op] of [['date_from', '>='], ['date_to', '<=']] as const) {
    if (!val(key)) continue;
    if (!DATE_RE.test(val(key)) || Number.isNaN(Date.parse(val(key)))) return { ok: false, error: `${key} must be YYYY-MM-DD` };
    add((n) => `(t.created_at AT TIME ZONE ${IST})::date ${op} $${n}::date`, val(key));
  }

  const search = val('q');
  if (search) {
    params.push(`%${search.replace(/[%_\\]/g, '\\$&')}%`);
    const n = params.length;
    conds.push(`(t.id::text ILIKE $${n} OR s.name ILIKE $${n} OR s.speed_id ILIKE $${n} OR s.customer_code ILIKE $${n} OR s.uid ILIKE $${n})`);
  }

  return { ok: true, filter: { where: conds.length ? conds.join(' AND ') : 'true', params } };
}

const BASE_FROM = `FROM tasks t LEFT JOIN stores s ON s.id = t.store_id`;

const fmt = (col: string) => `to_char(${col} AT TIME ZONE ${IST}, 'DD-Mon-YYYY HH24:MI')`;

/** One page (or the whole filtered set when limit is null) of report rows. */
export async function queryActivities(f: ActivityFilter, limit: number | null, offset: number) {
  const params = [...f.params];
  let pageSql = '';
  if (limit !== null) { params.push(limit, offset); pageSql = `LIMIT $${params.length - 1} OFFSET $${params.length}`; }

  const { rows } = await pool.query(
    `WITH page AS (
       SELECT t.id FROM tasks t LEFT JOIN stores s ON s.id = t.store_id
        WHERE ${f.where} ORDER BY t.created_at DESC, t.id ${pageSql}
     )
     SELECT
       t.id AS activity_id,
       ${TYPE_SQL} AS activity_type,
       t.activity_origin,
       t.status,
       ${fmt('t.created_at')} AS created_at,
       ${fmt('sub.first_submitted')} AS submitted_at,
       ${fmt('ap.at')} AS reviewed_at,
       ${fmt('t.completed_at')} AS completed_at,
       s.id AS outlet_id, s.customer_code, s.uid AS store_uid,
       ${OUTLET_SQL} AS outlet_type, s.speed_id,
       s.name AS outlet_name, s.address AS outlet_address, s.lat AS outlet_lat, s.long AS outlet_long,
       s.is_field_added AS new_outlet,
       v.uid AS vendor_uid, v.name AS vendor_name,
       e.uid AS employee_uid, e.name AS employee_name,
       cb.name AS created_by_name,
       ab.name AS assigned_by_name,
       oe.name AS original_employee_name,
       COALESCE(hist.n, 0) AS assignments,
       CASE WHEN t.task_type = 'recee' THEN t.status ELSE parent.status END AS recee_status,
       CASE WHEN t.task_type = 'installation' THEN t.status ELSE child.status END AS installation_status,
       ap.approval_status, ap.rejection_reason,
       COALESCE(sub.attempts, 0) AS submission_attempts,
       COALESCE(b.name, pl.brands) AS brand,
       COALESCE(aw.name, pl.artworks) AS artwork,
       COALESCE(sbs.label,
         CASE WHEN t.custom_width_cm IS NOT NULL AND t.custom_height_cm IS NOT NULL
              THEN round(t.custom_width_cm / 2.54) || 'x' || round(t.custom_height_cm / 2.54) || ' in (custom)' END,
         pl.sizes, rc.sizes) AS dimensions,
       t.target_pamphlet_count, ph.reported_pamphlets,
       COALESCE(ph.photo_count, 0) AS photo_count, ph.photo_urls
     FROM page
     JOIN tasks t ON t.id = page.id
     LEFT JOIN stores s ON s.id = t.store_id
     LEFT JOIN vendors v ON v.id = t.vendor_id
     LEFT JOIN users e ON e.id = t.employee_id
     LEFT JOIN users cb ON cb.id = t.created_by
     LEFT JOIN brands b ON b.id = t.brand_id
     LEFT JOIN artworks aw ON aw.id = t.artwork_id
     LEFT JOIN standard_boarding_sizes sbs ON sbs.id = t.boarding_size_id
     LEFT JOIN tasks parent ON parent.id = t.parent_task_id
     LEFT JOIN LATERAL (SELECT c.status FROM tasks c WHERE c.parent_task_id = t.id AND c.status <> 'cancelled' ORDER BY c.created_at DESC LIMIT 1) child ON true
     LEFT JOIN LATERAL (
       SELECT MIN(ts.timestamp) AS first_submitted, COUNT(*) AS attempts
         FROM task_steps ts WHERE ts.task_id = t.id AND ts.step_type IN ('recee', 'installation', 'pamphlet_drop')
     ) sub ON true
     LEFT JOIN LATERAL (
       SELECT ts.timestamp AS at, ts.approval_status, ts.rejection_reason
         FROM task_steps ts WHERE ts.task_id IN (t.id, t.parent_task_id) AND ts.step_type = 'approval'
        ORDER BY ts.timestamp DESC LIMIT 1
     ) ap ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS n,
              (array_agg(h.to_employee_id ORDER BY h.created_at ASC))[1] AS first_to
         FROM task_assignment_history h WHERE h.task_id = t.id
     ) hist ON true
     LEFT JOIN users oe ON oe.id = hist.first_to
     LEFT JOIN LATERAL (
       SELECT h.assigned_by FROM task_assignment_history h WHERE h.task_id = t.id ORDER BY h.created_at DESC LIMIT 1
     ) lasth ON true
     LEFT JOIN users ab ON ab.id = lasth.assigned_by
     LEFT JOIN LATERAL (
       SELECT string_agg(DISTINCT pb.name, ', ') FILTER (WHERE pb.name IS NOT NULL) AS brands,
              string_agg(DISTINCT pa.name, ', ') FILTER (WHERE pa.name IS NOT NULL) AS artworks,
              string_agg(DISTINCT COALESCE(psz.label,
                CASE WHEN p.custom_width_cm IS NOT NULL AND p.custom_height_cm IS NOT NULL
                     THEN round(p.custom_width_cm / 2.54) || 'x' || round(p.custom_height_cm / 2.54) || ' in (custom)' END), ', ')
                FILTER (WHERE psz.label IS NOT NULL OR p.custom_width_cm IS NOT NULL) AS sizes
         FROM task_signage_plan p
         LEFT JOIN brands pb ON pb.id = p.brand_id
         LEFT JOIN artworks pa ON pa.id = p.artwork_id
         LEFT JOIN standard_boarding_sizes psz ON psz.id = p.boarding_size_id
        WHERE p.task_id = t.id
     ) pl ON true
     LEFT JOIN LATERAL (
       SELECT string_agg(DISTINCT COALESCE(rsz.label,
                CASE WHEN tsp.custom_width_cm IS NOT NULL AND tsp.custom_height_cm IS NOT NULL
                     THEN round(tsp.custom_width_cm / 2.54) || 'x' || round(tsp.custom_height_cm / 2.54) || ' in (custom)' END), ', ')
                FILTER (WHERE rsz.label IS NOT NULL OR tsp.custom_width_cm IS NOT NULL) AS sizes
         FROM task_steps ts JOIN task_step_photos tsp ON tsp.task_step_id = ts.id
         LEFT JOIN standard_boarding_sizes rsz ON rsz.id = tsp.boarding_size_id
        WHERE ts.task_id = t.id AND ts.step_type = 'recee'
     ) rc ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(tsp.id) AS photo_count,
              string_agg(tsp.photo_url, ' | ' ORDER BY tsp.signage_index NULLS LAST, tsp.created_at) AS photo_urls,
              (SELECT SUM(ts2.pamphlet_count) FROM task_steps ts2 WHERE ts2.task_id = t.id AND ts2.pamphlet_count IS NOT NULL) AS reported_pamphlets
         FROM task_steps ts JOIN task_step_photos tsp ON tsp.task_step_id = ts.id WHERE ts.task_id = t.id
     ) ph ON true
     ORDER BY t.created_at DESC, t.id`,
    params
  );
  return rows;
}

export async function countActivities(f: ActivityFilter): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n ${BASE_FROM} WHERE ${f.where}`, f.params);
  return rows[0].n;
}

/** Metrics over exactly the filtered set, so they reconcile with the list/export. */
export async function summariseActivities(f: ActivityFilter) {
  const run = (sql: string) => pool.query(sql, f.params).then((r) => r.rows);
  const [totals, byType, byOutlet, byDay, byEmployee, byVendor] = await Promise.all([
    run(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE t.activity_origin = 'ASSIGNED')::int AS assigned,
                COUNT(*) FILTER (WHERE t.activity_origin = 'UNASSIGNED')::int AS unassigned,
                COUNT(*) FILTER (WHERE t.status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE t.status = 'recee_submitted')::int AS awaiting_review,
                COUNT(*) FILTER (WHERE t.status IN ('recee_approved', 'installed'))::int AS approved,
                COUNT(*) FILTER (WHERE t.status = 'recee_rejected')::int AS rejected_awaiting_rework,
                COUNT(*) FILTER (WHERE t.status = 'completed')::int AS completed,
                COUNT(DISTINCT s.id) FILTER (WHERE s.is_field_added)::int AS new_outlets_from_field
           ${BASE_FROM} WHERE ${f.where}`),
    run(`SELECT (${TYPE_SQL}) AS activity_type, t.activity_origin, COUNT(*)::int AS n
           ${BASE_FROM} WHERE ${f.where} GROUP BY 1, 2 ORDER BY 1, 2`),
    run(`SELECT (${OUTLET_SQL}) AS outlet_type, COUNT(*)::int AS n ${BASE_FROM} WHERE ${f.where} GROUP BY 1 ORDER BY 1`),
    run(`SELECT to_char((t.created_at AT TIME ZONE ${IST})::date, 'YYYY-MM-DD') AS day, (${TYPE_SQL}) AS activity_type, COUNT(*)::int AS n
           ${BASE_FROM} WHERE ${f.where} GROUP BY 1, 2 ORDER BY 1 DESC, 2`),
    run(`SELECT t.employee_id, e.name AS employee_name,
                COUNT(*) FILTER (WHERE t.activity_origin = 'ASSIGNED')::int AS assigned,
                COUNT(*) FILTER (WHERE t.activity_origin = 'UNASSIGNED')::int AS unassigned
           ${BASE_FROM} LEFT JOIN users e ON e.id = t.employee_id
          WHERE ${f.where} GROUP BY t.employee_id, e.name ORDER BY e.name NULLS LAST`),
    run(`SELECT t.vendor_id, v.name AS vendor_name,
                COUNT(*) FILTER (WHERE t.activity_origin = 'ASSIGNED')::int AS assigned,
                COUNT(*) FILTER (WHERE t.activity_origin = 'UNASSIGNED')::int AS unassigned
           ${BASE_FROM} LEFT JOIN vendors v ON v.id = t.vendor_id
          WHERE ${f.where} GROUP BY t.vendor_id, v.name ORDER BY v.name NULLS LAST`),
  ]);
  return { totals: totals[0], by_type: byType, by_outlet_type: byOutlet, by_day: byDay, by_employee: byEmployee, by_vendor: byVendor };
}

const OUTLET_LABELS: Record<string, string> = { speed: 'SPEED', non_speed: 'Non-SPEED', not_recorded: 'Not recorded' };

/** Presentation rows for the CSV export — readable headings, blank (not fake) values. */
export function toExportRow(r: Record<string, any>): Record<string, unknown> {
  const unassigned = r.activity_origin === 'UNASSIGNED';
  const typeLabel = TYPE_LABELS[r.activity_type] ?? r.activity_type;
  const blank = (v: unknown) => (v === null || v === undefined ? '' : v);
  return {
    'Activity ID': r.activity_id,
    'Activity Type': r.activity_type === 'recee' ? `${unassigned ? 'Unassigned' : 'Assigned'} Recee` : typeLabel,
    'Activity Origin': unassigned ? 'Unassigned' : 'Assigned',
    'Current Status': r.status,
    'Created': blank(r.created_at),
    'Submitted': blank(r.submitted_at),
    'Reviewed': blank(r.reviewed_at),
    'Completed': blank(r.completed_at),
    'Outlet ID': blank(r.outlet_id),
    'Customer Code': blank(r.customer_code),
    'Store UID': blank(r.store_uid),
    'Outlet Type': OUTLET_LABELS[r.outlet_type] ?? '',
    'SPEED ID': blank(r.speed_id),
    'Outlet Name': blank(r.outlet_name),
    'Outlet Address': blank(r.outlet_address),
    'Outlet Latitude': blank(r.outlet_lat),
    'Outlet Longitude': blank(r.outlet_long),
    'New Outlet From Field': r.new_outlet ? 'Yes' : 'No',
    'Vendor ID': blank(r.vendor_uid),
    'Vendor Name': blank(r.vendor_name),
    'Employee ID': blank(r.employee_uid),
    'Employee Name': blank(r.employee_name),
    'Created By': blank(r.created_by_name),
    'Assigned By': blank(r.assigned_by_name),
    'Original Assigned Employee': blank(r.original_employee_name),
    'Times Reassigned': Math.max(0, Number(r.assignments ?? 0) - 1),
    'Recee Status': blank(r.recee_status),
    'Installation Status': blank(r.installation_status),
    'Approval Status': blank(r.approval_status),
    'Rejection Reason': blank(r.rejection_reason),
    'Submission Attempts': Number(r.submission_attempts ?? 0),
    'Brand': blank(r.brand),
    'Artwork': blank(r.artwork),
    'Installation Dimensions': blank(r.dimensions),
    'Target Pamphlets': blank(r.target_pamphlet_count),
    'Reported Pamphlets': blank(r.reported_pamphlets),
    'Photo Count': Number(r.photo_count ?? 0),
    'Photo Links': blank(r.photo_urls),
  };
}
