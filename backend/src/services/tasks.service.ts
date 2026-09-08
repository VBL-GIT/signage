import { pool } from '../config/db';
import { TaskType, TaskStatus } from '../types/domain';

// Enforce valid status transitions server-side
const validTransitions: Record<TaskStatus, TaskStatus[]> = {
  pending: ['recee_submitted', 'completed'],
  recee_submitted: ['recee_approved', 'recee_rejected'],
  recee_approved: [],
  recee_rejected: ['recee_submitted'],
  installed: ['completed'],
  completed: [],
};

export function canTransition(current: TaskStatus, next: TaskStatus): boolean {
  return validTransitions[current]?.includes(next) ?? false;
}

export async function getTaskById(taskId: string) {
  const { rows } = await pool.query(
    `SELECT t.*,
       s.name as store_name, s.address as store_address, s.lat as store_lat, s.long as store_long,
       COALESCE(s.customer_code, s.uid) as store_uid, s.contact_no as store_contact_no, s.pincode as store_pincode,
       s.contact_email as store_contact_email, s.contact_person as store_contact_person,
       b.name as brand_name,
       sbs.label as boarding_size_label,
       e.name as employee_name,
       sup.name as supervisor_name
     FROM tasks t
     LEFT JOIN stores s ON s.id = t.store_id
     LEFT JOIN brands b ON b.id = t.brand_id
     LEFT JOIN standard_boarding_sizes sbs ON sbs.id = t.boarding_size_id
     LEFT JOIN users e ON e.id = t.employee_id
     LEFT JOIN users sup ON sup.id = t.supervisor_id
     WHERE t.id = $1`,
    [taskId]
  );
  return rows[0] || null;
}

export async function getTaskSteps(taskId: string) {
  const { rows } = await pool.query(
    `SELECT ts.*, u.name as performed_by_name, sbs.label as boarding_size_label,
       COALESCE(
         (SELECT json_agg(json_build_object(
            'id', tsp.id, 'photo_url', tsp.photo_url,
            'marker_x', tsp.marker_x, 'marker_y', tsp.marker_y,
            'annotation', tsp.annotation,
            'lat', tsp.lat, 'long', tsp.long,
            'signage_type', tsp.signage_type,
            'boarding_size_id', tsp.boarding_size_id,
            'boarding_size_label', psz.label,
            'custom_width_cm', tsp.custom_width_cm,
            'custom_height_cm', tsp.custom_height_cm,
            'brand_id', tsp.brand_id,
            'brand_name', COALESCE(pb.name, tsp.brand_label),
            'area_label', tsp.area_label,
            'distance_from_store_m', tsp.distance_from_store_m,
            'distance_from_first_m', tsp.distance_from_first_m,
            'distance_from_recee_m', tsp.distance_from_recee_m,
            'signage_index', tsp.signage_index
          ) ORDER BY tsp.signage_index ASC NULLS LAST, tsp.created_at ASC)
          FROM task_step_photos tsp
          LEFT JOIN standard_boarding_sizes psz ON psz.id = tsp.boarding_size_id
          LEFT JOIN brands pb ON pb.id = tsp.brand_id
          WHERE tsp.task_step_id = ts.id),
         '[]'
       ) as photos
     FROM task_steps ts
     LEFT JOIN users u ON u.id = ts.performed_by
     LEFT JOIN standard_boarding_sizes sbs ON sbs.id = ts.boarding_size_id
     WHERE ts.task_id = $1
     ORDER BY ts.timestamp ASC`,
    [taskId]
  );
  return rows;
}

/**
 * The predetermined list of signages to install for an installation task.
 * - post_recee  → derived on the fly from the source recee's signages (size/type),
 *                 with the approved brand applied to every signage.
 * - direct_boarding → stored rows in task_signage_plan (set at task creation).
 * Returns [] for recee / pamphlet / non-installation tasks.
 */
export async function getSignagePlan(task: {
  id: string; task_type: string; installation_type: string | null;
  parent_task_id: string | null; brand_id: string | null;
}) {
  if (task.task_type !== 'installation') return [];

  if (task.installation_type === 'post_recee') {
    // The full recee capture per signage — photo, annotation/marker and coords —
    // so the install screen can show each accepted signage's recee image for
    // reference (even after a partial approval re-indexed the plan).
    const receeByIndex = new Map<number, any>();
    if (task.parent_task_id) {
      const { rows: rc } = await pool.query(
        `SELECT tsp.signage_index, tsp.photo_url, tsp.annotation, tsp.marker_x, tsp.marker_y, tsp.lat, tsp.long
         FROM task_steps ts JOIN task_step_photos tsp ON tsp.task_step_id = ts.id
         WHERE ts.task_id = $1 AND ts.step_type = 'recee'`,
        [task.parent_task_id]
      );
      for (const r of rc) receeByIndex.set(Number(r.signage_index), r);
    }

    // Preferred: the per-signage plan the approver confirmed (brand + size +
    // artwork each), with recee_signage_index linking back to the source recee.
    const { rows: planRows } = await pool.query(
      `SELECT p.signage_index, p.recee_signage_index, p.signage_type,
              p.boarding_size_id, psz.label as boarding_size_label,
              p.custom_width_cm, p.custom_height_cm,
              p.brand_id, pb.name as brand_name,
              p.artwork_id, pa.name as artwork_name, pa.image_url as artwork_image_url
       FROM task_signage_plan p
       LEFT JOIN standard_boarding_sizes psz ON psz.id = p.boarding_size_id
       LEFT JOIN brands pb ON pb.id = p.brand_id
       LEFT JOIN artworks pa ON pa.id = p.artwork_id
       WHERE p.task_id = $1
       ORDER BY p.signage_index ASC`,
      [task.id]
    );
    if (planRows.length) {
      return planRows.map((p) => {
        const rc = receeByIndex.get(Number(p.recee_signage_index ?? p.signage_index)) ?? {};
        return {
          ...p,
          recee_photo_url: rc.photo_url ?? null,
          recee_annotation: rc.annotation ?? null,
          recee_marker_x: rc.marker_x ?? null,
          recee_marker_y: rc.marker_y ?? null,
          recee_lat: rc.lat ?? null,
          recee_long: rc.long ?? null,
        };
      });
    }

    // Fallback (older approvals with no stored plan): derive from recee signages + task brand.
    if (task.parent_task_id) {
      const { rows } = await pool.query(
        `SELECT tsp.signage_index, tsp.signage_type,
                tsp.boarding_size_id, psz.label as boarding_size_label,
                tsp.custom_width_cm, tsp.custom_height_cm,
                $2::uuid as brand_id, pb.name as brand_name,
                NULL::uuid as artwork_id, NULL::text as artwork_name, NULL::text as artwork_image_url,
                tsp.photo_url as recee_photo_url, tsp.annotation as recee_annotation,
                tsp.marker_x as recee_marker_x, tsp.marker_y as recee_marker_y,
                tsp.lat as recee_lat, tsp.long as recee_long
         FROM task_steps ts
         JOIN task_step_photos tsp ON tsp.task_step_id = ts.id
         LEFT JOIN standard_boarding_sizes psz ON psz.id = tsp.boarding_size_id
         LEFT JOIN brands pb ON pb.id = $2::uuid
         WHERE ts.task_id = $1 AND ts.step_type = 'recee'
         ORDER BY tsp.signage_index ASC NULLS LAST, tsp.created_at ASC`,
        [task.parent_task_id, task.brand_id]
      );
      return rows;
    }
    return [];
  }

  if (task.installation_type === 'direct_boarding') {
    const { rows } = await pool.query(
      `SELECT p.signage_index, p.signage_type,
              p.boarding_size_id, psz.label as boarding_size_label,
              p.custom_width_cm, p.custom_height_cm,
              p.brand_id, pb.name as brand_name,
              p.artwork_id, pa.name as artwork_name, pa.image_url as artwork_image_url,
              NULL::text as recee_photo_url, NULL::text as recee_annotation,
              NULL::numeric as recee_marker_x, NULL::numeric as recee_marker_y,
              NULL::numeric as recee_lat, NULL::numeric as recee_long
       FROM task_signage_plan p
       LEFT JOIN standard_boarding_sizes psz ON psz.id = p.boarding_size_id
       LEFT JOIN brands pb ON pb.id = p.brand_id
       LEFT JOIN artworks pa ON pa.id = p.artwork_id
       WHERE p.task_id = $1
       ORDER BY p.signage_index ASC`,
      [task.id]
    );
    return rows;
  }

  return [];
}

export async function transitionTask(taskId: string, newStatus: TaskStatus) {
  const { rows } = await pool.query(
    `UPDATE tasks
       SET status = $1::text, updated_at = NOW(),
           completed_at = CASE WHEN $1::text = 'completed' THEN NOW() ELSE completed_at END
     WHERE id = $2 RETURNING *`,
    [newStatus, taskId]
  );
  return rows[0];
}

/** The signage_index values captured in a recee task, ascending. */
export async function getReceeSignageIndices(taskId: string): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT tsp.signage_index
     FROM task_steps ts JOIN task_step_photos tsp ON tsp.task_step_id = ts.id
     WHERE ts.task_id = $1 AND ts.step_type = 'recee'
     ORDER BY tsp.signage_index ASC NULLS LAST`,
    [taskId]
  );
  return rows.map((r) => Number(r.signage_index)).filter((n) => Number.isFinite(n));
}

export interface ApprovalSignageSpec {
  signage_index: number;
  brand_id: string;
  artwork_id?: string | null;
  boarding_size_id?: string | null;
  custom_width_cm?: number | null;
  custom_height_cm?: number | null;
}

/**
 * Core recee approval/rejection used by BOTH the single-task approve endpoint and
 * bulk approval. Records the approval step; on approval creates the post_recee
 * installation task + one plan row per accepted signage (size falls back to the
 * recee suggestion when not overridden), linking each back to its recee signage.
 * Assumes the task is `recee_submitted` and specs are already validated.
 * Returns the transitioned recee task row.
 */
export async function processReceeApproval(
  task: { id: string; vendor_id: string | null; store_id: string | null },
  decision: { approval_status: 'approved' | 'rejected'; rejection_reason?: string | null; signages?: ApprovalSignageSpec[] },
  performedBy: string
) {
  await pool.query(
    `INSERT INTO task_steps (task_id, step_type, performed_by, approval_status, rejection_reason)
     VALUES ($1,'approval',$2,$3,$4)`,
    [task.id, performedBy, decision.approval_status, decision.rejection_reason || null]
  );

  if (decision.approval_status === 'approved') {
    const signages = decision.signages ?? [];
    const { rows: receeSigs } = await pool.query(
      `SELECT tsp.signage_index, tsp.signage_type, tsp.boarding_size_id, tsp.custom_width_cm, tsp.custom_height_cm
       FROM task_steps ts JOIN task_step_photos tsp ON tsp.task_step_id = ts.id
       WHERE ts.task_id = $1 AND ts.step_type = 'recee'`,
      [task.id]
    );
    const receeByIndex = new Map<number, any>();
    for (const rs of receeSigs) receeByIndex.set(Number(rs.signage_index), rs);

    const firstBrand = signages[0]?.brand_id ?? null;
    const { rows: created } = await pool.query(
      `INSERT INTO tasks (task_type, installation_type, parent_task_id, vendor_id, store_id, brand_id, status)
       VALUES ('installation','post_recee',$1,$2,$3,$4,'pending') RETURNING id`,
      [task.id, task.vendor_id, task.store_id, firstBrand]
    );
    const newTaskId = created[0].id;

    let planIndex = 0;
    for (const ov of signages) {
      const rs = receeByIndex.get(Number(ov.signage_index)) ?? {};
      let sizeId: string | null = null, cw: number | null = null, ch: number | null = null;
      if (ov.boarding_size_id) sizeId = ov.boarding_size_id;
      else if (ov.custom_width_cm && ov.custom_height_cm) { cw = ov.custom_width_cm; ch = ov.custom_height_cm; }
      else { sizeId = rs.boarding_size_id ?? null; cw = rs.custom_width_cm ?? null; ch = rs.custom_height_cm ?? null; }
      planIndex += 1;
      await pool.query(
        `INSERT INTO task_signage_plan (task_id, signage_index, recee_signage_index, signage_type, boarding_size_id, custom_width_cm, custom_height_cm, brand_id, artwork_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newTaskId, planIndex, Number(ov.signage_index), rs.signage_type ?? null, sizeId, cw, ch, ov.brand_id ?? firstBrand, ov.artwork_id ?? null]
      );
    }
  }

  const newStatus: TaskStatus = decision.approval_status === 'approved' ? 'recee_approved' : 'recee_rejected';
  return transitionTask(task.id, newStatus);
}
