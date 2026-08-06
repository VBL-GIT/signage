import { Response } from 'express';
import { pool } from '../config/db';
import { getTaskById, canTransition, transitionTask, getSignagePlan, processReceeApproval, getReceeSignageIndices } from '../services/tasks.service';
import { TaskStatus } from '../types/domain';
import { AuthRequest } from '../middleware/auth';

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

async function insertSignages(taskStepId: string, signages: SignageInput[]) {
  for (let i = 0; i < signages.length; i++) {
    const s = signages[i];
    await pool.query(
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
    const first = photos[0];
    const { rows } = await pool.query(
      `INSERT INTO task_steps (task_id, step_type, performed_by, lat, long, notes, pamphlet_count)
       VALUES ($1,'installation',$2,$3,$4,$5,$6) RETURNING id`,
      [task.id, req.user!.id, first.lat ?? null, first.long ?? null, notes || null, photos.length]
    );
    for (const p of photos) {
      await pool.query(
        `INSERT INTO task_step_photos (task_step_id, photo_url, lat, long, area_label, brand_label)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [rows[0].id, p.photo_url, p.lat ?? null, p.long ?? null, p.area_label ?? null, p.brand_label ?? null]
      );
    }
    if (pincode) await pool.query('UPDATE tasks SET pincode = $1 WHERE id = $2', [pincode, task.id]);
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
