import { Response } from 'express';
import crypto from 'crypto';
import { Pool, PoolClient } from 'pg';
import { pool } from '../config/db';
import { getTaskById, canTransition, transitionTask, getSignagePlan, processReceeApproval, getReceeSignageIndices } from '../services/tasks.service';
import { TaskStatus } from '../types/domain';
import { AuthRequest } from '../middleware/auth';
import { normalizeStoreInput, upsertStore, isStoreInactive, storeConflictMessage } from '../services/stores.service';

interface SignageInput {
  photo_url: string;
  lat: number;
  long: number;
  signage_type?: string | null;
  boarding_size_id?: string | null;
  custom_width_cm?: number | null;
  custom_height_cm?: number | null;
  brand_id?: string | null;
  distance_from_store_m?: number | null;
  distance_from_first_m?: number | null;
  distance_from_recee_m?: number | null;
  marker_x?: number | null;
  marker_y?: number | null;
  annotation?: string | null;
}

async function insertSignages(taskStepId: string, signages: SignageInput[], q: Pool | PoolClient = pool) {
  for (let i = 0; i < signages.length; i++) {
    const s = signages[i];
    await q.query(
      `INSERT INTO task_step_photos
        (task_step_id, photo_url, marker_x, marker_y, annotation, lat, long, signage_type,
         boarding_size_id, custom_width_cm, custom_height_cm, brand_id,
         distance_from_store_m, distance_from_first_m, distance_from_recee_m, signage_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [taskStepId, s.photo_url, s.marker_x ?? null, s.marker_y ?? null, s.annotation ?? null,
       s.lat ?? null, s.long ?? null, s.signage_type ?? null,
       s.boarding_size_id ?? null, s.custom_width_cm ?? null, s.custom_height_cm ?? null, s.brand_id ?? null,
       s.distance_from_store_m ?? null, s.distance_from_first_m ?? null, s.distance_from_recee_m ?? null,
       i + 1]
    );
  }
}

export async function submitRecee(req: AuthRequest, res: Response) {
  const task = await getTaskById(req.params.id as string);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  // Only the employee this task is assigned to may submit field steps for it.
  if (task.employee_id !== req.user!.id) {
    res.status(403).json({ error: 'This task is not assigned to you' }); return;
  }
  if (task.task_type !== 'recee') {
    res.status(400).json({ error: 'Task type does not support recee' }); return;
  }
  if (!canTransition(task.status, 'recee_submitted')) {
    res.status(400).json({ error: `Cannot submit recee from status: ${task.status}` }); return;
  }

  const { notes, signages } = req.body as { notes?: string; signages: SignageInput[] };
  if (!signages?.length) { res.status(400).json({ error: 'At least one signage is required' }); return; }

  // Step-level lat/long mirrors the first signage's capture location.
  const first = signages[0];
  const { rows } = await pool.query(
    `INSERT INTO task_steps (task_id, step_type, performed_by, lat, long, notes)
     VALUES ($1,'recee',$2,$3,$4,$5) RETURNING id`,
    [task.id, req.user!.id, first.lat, first.long, notes || null]
  );
  await insertSignages(rows[0].id, signages);

  const updated = await transitionTask(task.id, 'recee_submitted');
  res.json(updated);
}

export async function approveRecee(req: AuthRequest, res: Response) {
  const task = await getTaskById(req.params.id as string);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.status !== 'recee_submitted') {
    res.status(400).json({ error: 'No pending recee to approve' }); return;
  }

  const { approval_status, rejection_reason, signages } = req.body as {
    approval_status: 'approved' | 'rejected';
    rejection_reason?: string;
    signages?: {
      signage_index: number; brand_id: string; artwork_id?: string;
      boarding_size_id?: string; custom_width_cm?: number; custom_height_cm?: number;
    }[];
  };
  const newStatus: TaskStatus = approval_status === 'approved' ? 'recee_approved' : 'recee_rejected';

  // Partial approval: the approver accepts only some signages. `signages` contains
  // just the accepted ones; an approval must accept at least one.
  if (approval_status === 'approved' && !(signages && signages.length)) {
    res.status(400).json({ error: 'Select at least one signage to approve (or reject the recee).' });
    return;
  }

  // Each chosen artwork must belong to that signage's brand.
  if (approval_status === 'approved') {
    const artworkIds = [...new Set(signages!.map((s) => s.artwork_id).filter(Boolean) as string[])];
    if (artworkIds.length) {
      const { rows: aw } = await pool.query('SELECT id, brand_id FROM artworks WHERE id = ANY($1)', [artworkIds]);
      const brandByArtwork = new Map<string, string>(aw.map((a) => [a.id, a.brand_id]));
      for (const s of signages!) {
        if (s.artwork_id && brandByArtwork.get(s.artwork_id) !== s.brand_id) {
          res.status(400).json({ error: 'Selected artwork does not belong to the chosen brand' });
          return;
        }
      }
    }
  }

  const updated = await processReceeApproval(task, { approval_status, rejection_reason, signages }, req.user!.id);
  res.json(updated);
}

/**
 * Bulk approve/reject recee tasks (RJCorp head office).
 *  - approve: applies ONE brand (+ optional artwork) to every signage of every
 *    selected task, accepting all signages, keeping each recee's suggested size.
 *  - reject:  records a rejection with a shared reason.
 * Each task is processed independently; failures are reported, not fatal.
 */
export async function approveBulk(req: AuthRequest, res: Response) {
  const { action, task_ids, brand_id, artwork_id, rejection_reason } = req.body as {
    action: 'approve' | 'reject';
    task_ids: string[];
    brand_id?: string;
    artwork_id?: string;
    rejection_reason?: string;
  };

  if (action === 'approve') {
    if (!brand_id) { res.status(400).json({ error: 'brand_id is required to bulk-approve' }); return; }
    if (artwork_id) {
      const { rows } = await pool.query('SELECT brand_id FROM artworks WHERE id = $1', [artwork_id]);
      if (!rows[0]) { res.status(400).json({ error: 'Unknown artwork' }); return; }
      if (rows[0].brand_id !== brand_id) { res.status(400).json({ error: 'Artwork does not belong to the chosen brand' }); return; }
    }
  } else if (!rejection_reason?.trim()) {
    res.status(400).json({ error: 'A rejection reason is required' }); return;
  }

  const results = { approved: 0, rejected: 0, failed: [] as { task_id: string; reason: string }[] };

  for (const id of task_ids) {
    try {
      const task = await getTaskById(id);
      if (!task) { results.failed.push({ task_id: id, reason: 'Task not found' }); continue; }
      if (task.status !== 'recee_submitted') {
        results.failed.push({ task_id: id, reason: `Not awaiting approval (${task.status})` }); continue;
      }
      if (action === 'approve') {
        const indices = await getReceeSignageIndices(id);
        if (!indices.length) { results.failed.push({ task_id: id, reason: 'No recee signages to approve' }); continue; }
        const sigs = indices.map((si) => ({ signage_index: si, brand_id: brand_id!, artwork_id: artwork_id || null }));
        await processReceeApproval(task, { approval_status: 'approved', signages: sigs }, req.user!.id);
        results.approved += 1;
      } else {
        await processReceeApproval(task, { approval_status: 'rejected', rejection_reason }, req.user!.id);
        results.rejected += 1;
      }
    } catch (e) {
      results.failed.push({ task_id: id, reason: (e as Error).message || 'Unknown error' });
    }
  }

  res.json(results);
}

export async function submitInstallation(req: AuthRequest, res: Response) {
  const task = await getTaskById(req.params.id as string);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  // Only the employee this task is assigned to may submit field steps for it.
  if (task.employee_id !== req.user!.id) {
    res.status(403).json({ error: 'This task is not assigned to you' }); return;
  }
  if (task.task_type !== 'installation') {
    res.status(400).json({ error: 'Task type does not support installation' }); return;
  }
  if (task.status !== 'pending') {
    res.status(400).json({ error: `Cannot install from status: ${task.status}` }); return;
  }

  // ---- Pamphlet distribution ('direct'): one photo per drop point, each with
  // its own GPS, store/area and brand. The pamphlet count IS the photo count. ----
  if (task.installation_type === 'direct') {
    const { notes, photos, pincode } = req.body as {
      notes?: string; pincode?: string;
      photos: { photo_url: string; lat?: number; long?: number; area_label?: string; brand_label?: string }[];
    };
    if (!photos?.length) {
      res.status(400).json({ error: 'Take at least one photo to submit' }); return;
    }
    // Defense-in-depth: the route's zod schema already requires this whenever
    // `photos` is present, but re-check here too (matches the same
    // require-and-recheck pattern the mobile UI uses before calling in).
    if (!pincode?.trim()) {
      res.status(400).json({ error: 'Pincode is required for pamphlet distribution' }); return;
    }
    const first = photos[0];
    const { rows } = await pool.query(
      `INSERT INTO task_steps (task_id, step_type, performed_by, lat, long, notes, pamphlet_count)
       VALUES ($1,'installation',$2,$3,$4,$5,$6) RETURNING id`,
      [task.id, req.user!.id, first.lat ?? null, first.long ?? null, notes || null, photos.length]
    );
    // Brand is a single preset the admin chose at task creation (task.brand_id),
    // shown read-only to the employee — not typed per photo — so every photo
    // carries the same brand_id. brand_label is kept only for older tasks that
    // predate the preset and still send free text.
    for (const p of photos) {
      await pool.query(
        `INSERT INTO task_step_photos (task_step_id, photo_url, lat, long, area_label, brand_label, brand_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [rows[0].id, p.photo_url, p.lat ?? null, p.long ?? null, p.area_label ?? null, p.brand_label ?? null, task.brand_id ?? null]
      );
    }
    await pool.query('UPDATE tasks SET pincode = $1 WHERE id = $2', [pincode.trim(), task.id]);
    const updated = await transitionTask(task.id, 'completed');
    res.json(updated);
    return;
  }

  // ---- Boarding install (post_recee / direct_boarding): one photo per planned signage ----
  // The signage specs (size/brand/type) come from the task's plan — the employee only
  // supplies a photo + GPS + the client-computed distances for each planned signage.
  const { notes, signages } = req.body as {
    notes?: string;
    signages: {
      signage_index: number; photo_url: string; lat: number; long: number;
      distance_from_store_m?: number; distance_from_first_m?: number; distance_from_recee_m?: number;
    }[];
  };
  if (!signages?.length) { res.status(400).json({ error: 'A photo is required for each planned signage' }); return; }

  const plan = await getSignagePlan(task);
  const planByIndex = new Map<number, any>();
  for (const p of plan) planByIndex.set(Number(p.signage_index), p);

  const first = signages[0];
  const { rows } = await pool.query(
    `INSERT INTO task_steps (task_id, step_type, performed_by, lat, long, notes)
     VALUES ($1,'installation',$2,$3,$4,$5) RETURNING id`,
    [task.id, req.user!.id, first.lat, first.long, notes || null]
  );

  const merged: SignageInput[] = signages.map((s) => {
    const spec = planByIndex.get(Number(s.signage_index)) ?? {};
    return {
      photo_url: s.photo_url,
      lat: s.lat,
      long: s.long,
      signage_type: spec.signage_type ?? null,
      boarding_size_id: spec.boarding_size_id ?? null,
      custom_width_cm: spec.custom_width_cm ?? null,
      custom_height_cm: spec.custom_height_cm ?? null,
      brand_id: spec.brand_id ?? null,
      distance_from_store_m: s.distance_from_store_m ?? null,
      distance_from_first_m: s.distance_from_first_m ?? null,
      distance_from_recee_m: s.distance_from_recee_m ?? null,
    };
  });
  await insertSignages(rows[0].id, merged);

  const updated = await transitionTask(task.id, 'completed');
  res.json(updated);
}

type FieldBody = {
  store_id?: string;
  outlet?: Record<string, unknown>;
  brand_id?: string;
  artwork_id?: string;
  notes?: string;
  signages: SignageInput[];
  allow_duplicate?: boolean;
  client_request_id?: string;
};

type OutletResult =
  | { ok: true; storeId: string; created: boolean; lat: number; long: number }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * The outlet half of both field workflows. Either picks an existing store
 * (`store_id`, from the nearby-outlets check) or creates a new one flagged
 * is_field_added with a placeholder `FLD-` Customer Code that head office later
 * replaces (see upsertStore). Runs inside the caller's transaction.
 */
async function resolveFieldOutlet(
  client: PoolClient, userId: string, vendorId: string | null, body: FieldBody
): Promise<OutletResult> {
  const fail = (status: number, error: string, extra: Record<string, unknown> = {}): OutletResult =>
    ({ ok: false, status, body: { error, ...extra } });

  if (body.store_id) {
    const { rows } = await client.query(
      'SELECT id, name, lat, long, vendor_id, outlet_status FROM stores WHERE id = $1', [body.store_id]
    );
    const st = rows[0];
    if (!st) return fail(404, 'Store not found');
    if (st.vendor_id && vendorId && st.vendor_id !== vendorId) return fail(403, 'This store belongs to another vendor');
    if (isStoreInactive(st.outlet_status)) {
      return fail(409, `Store "${st.name}" is ${st.outlet_status}. Work cannot be recorded for an inactive store.`);
    }
    return { ok: true, storeId: st.id, created: false, lat: Number(st.lat), long: Number(st.long) };
  }

  // Placeholder Customer Code: unique, recognisable, replaced by head office.
  let code = '';
  for (let i = 0; i < 5; i++) {
    const c = `FLD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const { rows } = await client.query('SELECT 1 FROM stores WHERE lower(customer_code) = lower($1)', [c]);
    if (!rows.length) { code = c; break; }
  }
  if (!code) throw new Error('Could not generate an outlet code');

  const { input, errors } = normalizeStoreInput({ ...body.outlet, customer_code: code, vendor_id: vendorId });
  if (errors.length) return fail(400, errors[0], { details: errors });

  if (!body.allow_duplicate) {
    const { rows: dupe } = await client.query(
      `SELECT id, name FROM stores
        WHERE lower(name) = lower($1) AND pincode = $2
          AND (vendor_id IS NULL OR $3::uuid IS NULL OR vendor_id = $3) LIMIT 1`,
      [input.name, input.pincode, vendorId]
    );
    if (dupe.length) {
      return fail(409, `An outlet named "${dupe[0].name}" already exists in pincode ${input.pincode}. Pick it from the list instead.`,
        { duplicate_store_id: dupe[0].id });
    }
  }

  const { store } = await upsertStore(client, input, null);
  await client.query('UPDATE stores SET is_field_added = true, added_by = $2 WHERE id = $1', [store.id, userId]);
  return { ok: true, storeId: store.id as string, created: true, lat: input.lat, long: input.long };
}

/** A retry of a submission that already went through gets the original result back. */
async function findExistingFieldTask(req: AuthRequest, res: Response, requestId?: string): Promise<boolean> {
  if (!requestId) return false;
  const { rows } = await pool.query(
    'SELECT id, store_id FROM tasks WHERE client_request_id = $1 AND employee_id = $2',
    [requestId, req.user!.id]
  );
  if (!rows.length) return false;
  res.status(200).json({ task_id: rows[0].id, store_id: rows[0].store_id, store_created: false, duplicate_request: true });
  return true;
}

async function checkBrandArtwork(res: Response, brandId?: string, artworkId?: string): Promise<boolean> {
  if (brandId) {
    const { rows } = await pool.query('SELECT 1 FROM brands WHERE id = $1', [brandId]);
    if (!rows.length) { res.status(404).json({ error: 'Brand not found' }); return false; }
  }
  if (artworkId) {
    const { rows } = await pool.query('SELECT brand_id FROM artworks WHERE id = $1', [artworkId]);
    if (!rows.length) { res.status(404).json({ error: 'Artwork not found' }); return false; }
    if (brandId && rows[0].brand_id !== brandId) {
      res.status(400).json({ error: 'Selected artwork does not belong to the chosen brand' }); return false;
    }
  }
  return true;
}

/**
 * Field workflow 1 — recee of an outlet nobody assigned. Outlet, task, recee step
 * and photos are written in ONE transaction and the task lands straight in
 * `recee_submitted`, joining the normal approval queue; the employee owns the
 * task, so the follow-up installation created on approval is theirs too.
 */
export async function createFieldRecee(req: AuthRequest, res: Response) {
  const user = req.user!;
  const body = req.body as FieldBody;
  if (!body.store_id && !body.outlet) {
    res.status(400).json({ error: 'Provide an existing store or the new outlet details' }); return;
  }
  if (await findExistingFieldTask(req, res, body.client_request_id)) return;
  if (!(await checkBrandArtwork(res, body.brand_id))) return;

  const { rows: me } = await pool.query('SELECT vendor_id FROM users WHERE id = $1', [user.id]);
  const vendorId: string | null = me[0]?.vendor_id ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outlet = await resolveFieldOutlet(client, user.id, vendorId, body);
    if (!outlet.ok) { await client.query('ROLLBACK'); res.status(outlet.status).json(outlet.body); return; }

    const { rows: t } = await client.query(
      `INSERT INTO tasks (task_type, status, vendor_id, store_id, employee_id, brand_id,
         is_field_initiated, assigned_at, assignment_count, client_request_id)
       VALUES ('recee', 'recee_submitted', $1, $2, $3, $4, true, NOW(), 1, $5) RETURNING id`,
      [vendorId, outlet.storeId, user.id, body.brand_id || null, body.client_request_id || null]
    );
    const taskId = t[0].id as string;

    const first = body.signages[0];
    const { rows: step } = await client.query(
      `INSERT INTO task_steps (task_id, step_type, performed_by, lat, long, notes)
       VALUES ($1,'recee',$2,$3,$4,$5) RETURNING id`,
      [taskId, user.id, first.lat, first.long, body.notes || null]
    );
    await insertSignages(
      step[0].id,
      body.signages.map((s) => ({ ...s, brand_id: body.brand_id ?? s.brand_id ?? null })),
      client
    );

    await client.query('COMMIT');
    res.status(201).json({ task_id: taskId, store_id: outlet.storeId, store_created: outlet.created });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    const msg = storeConflictMessage(e);
    if (msg) { res.status(409).json({ error: msg }); return; }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Field workflow 2 — installation of an outlet nobody assigned, with no recee.
 * Nothing was planned by an admin, so the employee supplies what a plan would
 * have held (type, size, brand, artwork) along with the installation photos.
 * Outlet, task (a completed 'direct_boarding' installation), its signage plan
 * and the installation step are written in one transaction; there is no
 * approval step, matching an assigned installation without recee.
 */
export async function createFieldInstall(req: AuthRequest, res: Response) {
  const user = req.user!;
  const body = req.body as FieldBody;
  if (!body.store_id && !body.outlet) {
    res.status(400).json({ error: 'Provide an existing store or the new outlet details' }); return;
  }
  if (await findExistingFieldTask(req, res, body.client_request_id)) return;
  if (!(await checkBrandArtwork(res, body.brand_id, body.artwork_id))) return;

  const { rows: me } = await pool.query('SELECT vendor_id FROM users WHERE id = $1', [user.id]);
  const vendorId: string | null = me[0]?.vendor_id ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outlet = await resolveFieldOutlet(client, user.id, vendorId, body);
    if (!outlet.ok) { await client.query('ROLLBACK'); res.status(outlet.status).json(outlet.body); return; }

    const { rows: t } = await client.query(
      `INSERT INTO tasks (task_type, installation_type, status, vendor_id, store_id, employee_id, brand_id, artwork_id,
         is_field_initiated, assigned_at, assignment_count, completed_at, client_request_id)
       VALUES ('installation', 'direct_boarding', 'completed', $1, $2, $3, $4, $5, true, NOW(), 1, NOW(), $6)
       RETURNING id`,
      [vendorId, outlet.storeId, user.id, body.brand_id || null, body.artwork_id || null, body.client_request_id || null]
    );
    const taskId = t[0].id as string;

    // The plan records what was installed, so the task reads like any other
    // installation to head office, the reports and the task detail screens.
    for (let i = 0; i < body.signages.length; i++) {
      const s = body.signages[i];
      await client.query(
        `INSERT INTO task_signage_plan (task_id, signage_index, signage_type, boarding_size_id,
           custom_width_cm, custom_height_cm, brand_id, artwork_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [taskId, i + 1, s.signage_type ?? null, s.boarding_size_id ?? null,
         s.custom_width_cm ?? null, s.custom_height_cm ?? null, body.brand_id ?? null, body.artwork_id ?? null]
      );
    }

    const first = body.signages[0];
    const { rows: step } = await client.query(
      `INSERT INTO task_steps (task_id, step_type, performed_by, lat, long, notes)
       VALUES ($1,'installation',$2,$3,$4,$5) RETURNING id`,
      [taskId, user.id, first.lat, first.long, body.notes || null]
    );
    await insertSignages(
      step[0].id,
      body.signages.map((s) => ({ ...s, brand_id: body.brand_id ?? null })),
      client
    );

    await client.query('COMMIT');
    res.status(201).json({ task_id: taskId, store_id: outlet.storeId, store_created: outlet.created });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    const msg = storeConflictMessage(e);
    if (msg) { res.status(409).json({ error: msg }); return; }
    throw e;
  } finally {
    client.release();
  }
}
