import { Response } from 'express';
import { pool } from '../config/db';
import { getTaskById, getTaskSteps, getSignagePlan } from '../services/tasks.service';
import { AuthRequest } from '../middleware/auth';
import { isHeadOffice } from '../auth/privileges';

// Same visibility rules as listTasks: head office sees all, vendor staff see
// their vendor's tasks, an employee sees only tasks assigned to them.
function canViewTask(user: NonNullable<AuthRequest['user']>, task: { vendor_id: string | null; employee_id: string | null }): boolean {
  if (isHeadOffice(user.role)) return true;
  if (user.role === 'vendor_admin' || user.role === 'vendor_user') return task.vendor_id === user.vendor_id;
  if (user.role === 'employee') return task.employee_id === user.id;
  return false;
}

// Bounded pagination so a single request can never scan the whole tasks table
// at VBL scale. Callers may pass ?limit&offset; both are clamped server-side.
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export async function listTasks(req: AuthRequest, res: Response) {
  const user = req.user!;
  const { status, type, store_id } = req.query;

  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? ''), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(String(req.query.offset ?? ''), 10) || 0, 0);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  // Role-based visibility:
  //  - employee: only tasks assigned to them
  //  - vendor_admin / vendor_user: all tasks for their vendor
  //  - rjcorp_admin / rjcorp_user: everything
  if (user.role === 'employee') {
    conditions.push(`t.employee_id = $${idx++}`);
    params.push(user.id);
  } else if (user.role === 'vendor_admin' || user.role === 'vendor_user') {
    conditions.push(`t.vendor_id = $${idx++}`);
    params.push(user.vendor_id);
  }

  if (status) { conditions.push(`t.status = $${idx++}`); params.push(status); }
  if (type) { conditions.push(`t.task_type = $${idx++}`); params.push(type); }
  if (store_id) { conditions.push(`t.store_id = $${idx++}`); params.push(store_id); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT t.*, s.name as store_name, COALESCE(s.customer_code, s.uid) as store_uid, s.pincode as store_pincode,
            b.name as brand_name,
            e.name as employee_name, v.name as vendor_name, v.uid as vendor_uid
     FROM tasks t
     LEFT JOIN stores s ON s.id = t.store_id
     LEFT JOIN brands b ON b.id = t.brand_id
     LEFT JOIN users e ON e.id = t.employee_id
     LEFT JOIN vendors v ON v.id = t.vendor_id
     ${where}
     ORDER BY t.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );
  res.json(rows);
}

export async function getTask(req: AuthRequest, res: Response) {
  const task = await getTaskById(req.params.id as string);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (!canViewTask(req.user!, task)) {
    res.status(403).json({ error: 'You do not have access to this task' }); return;
  }
  const steps = await getTaskSteps(task.id);
  const signage_plan = await getSignagePlan(task);

  // The recee → installation folding is a head-office concept: RJCorp sees the
  // pair as one job and assigns/tracks the install inline from the recee. Vendors
  // and employees treat the recee and its installation as two separate tasks
  // (the install shows up on its own in their list), so only head office gets
  // the install embedded here. There is at most one child per recee.
  let post_recee_task = null;
  if (task.task_type === 'recee' && isHeadOffice(req.user!.role)) {
    const { rows } = await pool.query(
      'SELECT id FROM tasks WHERE parent_task_id = $1 ORDER BY created_at DESC LIMIT 1',
      [task.id]
    );
    if (rows[0]) {
      const child = await getTaskById(rows[0].id);
      if (child) {
        const childSteps = await getTaskSteps(child.id);
        const childPlan = await getSignagePlan(child);
        post_recee_task = { ...child, steps: childSteps, signage_plan: childPlan };
      }
    }
  }

  res.json({ ...task, steps, signage_plan, post_recee_task });
}

export async function createTask(req: AuthRequest, res: Response) {
  // RJCorp admin creates a task against a vendor; employee is assigned later by the vendor.
  const {
    task_type, installation_type, vendor_id, store_id, employee_id, supervisor_id,
    brand_id, artwork_id, boarding_size_id, custom_width_cm, custom_height_cm, signage_type,
    pincode, target_pamphlet_count,
  } = req.body;

  if (task_type === 'recee') {
    if (!store_id) { res.status(400).json({ error: 'store_id is required for recee tasks' }); return; }
  } else if (task_type === 'installation') {
    // Admin may create either a pamphlet distribution ('direct') or a boarding
    // installation with no prior recee ('direct_boarding'). 'post_recee' tasks
    // are only created by the system when a recee is approved.
    if (installation_type !== 'direct' && installation_type !== 'direct_boarding') {
      res.status(400).json({ error: "installation_type must be 'direct' or 'direct_boarding' (post_recee tasks are system-generated)" }); return;
    }
    if (installation_type === 'direct_boarding' && !store_id) {
      res.status(400).json({ error: 'store_id is required for boarding installation tasks' }); return;
    }
  }

  // Every id below is a foreign key. Zod proves the value is a well-formed UUID
  // but not that the row exists, so an unknown id would otherwise reach the
  // INSERT and trip a constraint — surfacing as a blanket 500 that says nothing
  // about which reference was wrong. Check them here and answer 404 naming the
  // specific entity. (The bulk importer resolves these by UID and already
  // rejects unknown values per row.)
  const missingRef = async (sql: string, id: string) =>
    (await pool.query(sql, [id])).rows.length === 0;

  if (store_id && await missingRef('SELECT 1 FROM stores WHERE id = $1', store_id)) {
    res.status(404).json({ error: 'Store not found' }); return;
  }
  if (vendor_id && await missingRef('SELECT 1 FROM vendors WHERE id = $1', vendor_id)) {
    res.status(404).json({ error: 'Vendor not found' }); return;
  }
  if (employee_id && await missingRef('SELECT 1 FROM users WHERE id = $1', employee_id)) {
    res.status(404).json({ error: 'Employee not found' }); return;
  }
  if (supervisor_id && await missingRef('SELECT 1 FROM users WHERE id = $1', supervisor_id)) {
    res.status(404).json({ error: 'Supervisor not found' }); return;
  }
  if (brand_id && await missingRef('SELECT 1 FROM brands WHERE id = $1', brand_id)) {
    res.status(404).json({ error: 'Brand not found' }); return;
  }
  if (artwork_id && await missingRef('SELECT 1 FROM artworks WHERE id = $1', artwork_id)) {
    res.status(404).json({ error: 'Artwork not found' }); return;
  }
  if (boarding_size_id && await missingRef('SELECT 1 FROM standard_boarding_sizes WHERE id = $1', boarding_size_id)) {
    res.status(404).json({ error: 'Boarding size not found' }); return;
  }

  const isInstall = task_type === 'installation';
  const isBoarding = isInstall && installation_type === 'direct_boarding';

  const { rows } = await pool.query(
    `INSERT INTO tasks (task_type, installation_type, vendor_id, store_id, employee_id, supervisor_id,
       brand_id, artwork_id, boarding_size_id, custom_width_cm, custom_height_cm, pincode, target_pamphlet_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [task_type, isInstall ? installation_type : null, vendor_id,
     store_id || null, employee_id || null, supervisor_id || null,
     isBoarding ? (brand_id || null) : null,
     isBoarding ? (artwork_id || null) : null,
     isBoarding ? (boarding_size_id || null) : null,
     isBoarding ? (custom_width_cm || null) : null,
     isBoarding ? (custom_height_cm || null) : null,
     pincode || null, target_pamphlet_count || null]
  );
  const task = rows[0];

  // Seed a one-signage plan for a direct boarding install so the employee sees a
  // predetermined requirement to photograph. (Multi-signage demo plans are seeded
  // via reset-tasks.ts.)
  if (isBoarding) {
    await pool.query(
      `INSERT INTO task_signage_plan (task_id, signage_index, signage_type, boarding_size_id, custom_width_cm, custom_height_cm, brand_id, artwork_id)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [task.id, signage_type || null, boarding_size_id || null, custom_width_cm || null, custom_height_cm || null, brand_id || null, artwork_id || null]
    );
  }

  res.status(201).json(task);
}

export async function assignTask(req: AuthRequest, res: Response) {
  // Vendor admin assigns/reassigns within their own vendor only. RJCorp admin/user
  // (head office / superuser) may assign to ANY vendor's employee — the task then
  // moves to that employee's vendor so scoping stays consistent.
  const { employee_id } = req.body;
  const task = await getTaskById(req.params.id as string);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const isHeadOffice = req.user!.role === 'rjcorp_admin' || req.user!.role === 'rjcorp_user';
  if (!isHeadOffice && task.vendor_id !== req.user!.vendor_id) {
    res.status(403).json({ error: 'This task does not belong to your vendor' }); return;
  }

  const { rows: empRows } = await pool.query(
    'SELECT id, vendor_id, role FROM users WHERE id = $1 AND is_active = true',
    [employee_id]
  );
  const emp = empRows[0];
  if (!emp || emp.role !== 'employee') {
    res.status(400).json({ error: 'Employee not found or inactive' }); return;
  }

  if (isHeadOffice) {
    // Cross-vendor allowed; retarget the task to the employee's vendor.
    const newVendorId = emp.vendor_id ?? task.vendor_id;
    const { rows } = await pool.query(
      `UPDATE tasks SET employee_id = $1, vendor_id = $2, assigned_at = NOW(),
         assignment_count = assignment_count + 1, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [employee_id, newVendorId, task.id]
    );
    res.json(rows[0]);
    return;
  }

  // Vendor admin: employee must belong to the task's vendor.
  if (!task.vendor_id) {
    res.status(400).json({ error: 'Task is not scoped to a vendor' }); return;
  }
  if (emp.vendor_id !== task.vendor_id) {
    res.status(400).json({ error: "Employee not found in the task's vendor" }); return;
  }
  const { rows } = await pool.query(
    `UPDATE tasks SET employee_id = $1, assigned_at = NOW(),
       assignment_count = assignment_count + 1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [employee_id, task.id]
  );
  res.json(rows[0]);
}

/**
 * Bulk assign / reassign tasks to a single employee.
 *  - Head office (rjcorp): may assign across vendors; each task retargets to the
 *    employee's vendor so scoping stays consistent (mirrors single assignTask).
 *  - Vendor admin: may only assign their own vendor's employees to their own
 *    vendor's tasks.
 * The employee is validated once; each task is processed independently and
 * failures are reported rather than aborting the batch.
 */
export async function assignBulk(req: AuthRequest, res: Response) {
  const { task_ids, employee_id } = req.body as { task_ids: string[]; employee_id: string };
  const isHeadOffice = req.user!.role === 'rjcorp_admin' || req.user!.role === 'rjcorp_user';

  const { rows: empRows } = await pool.query(
    'SELECT id, vendor_id, role FROM users WHERE id = $1 AND is_active = true',
    [employee_id]
  );
  const emp = empRows[0];
  if (!emp || emp.role !== 'employee') {
    res.status(400).json({ error: 'Employee not found or inactive' }); return;
  }
  // A vendor admin can only hand work to their own vendor's employees.
  if (!isHeadOffice && emp.vendor_id !== req.user!.vendor_id) {
    res.status(403).json({ error: 'You can only assign employees in your own vendor' }); return;
  }

  const results = { assigned: 0, failed: [] as { task_id: string; reason: string }[] };

  for (const id of task_ids) {
    try {
      const task = await getTaskById(id);
      if (!task) { results.failed.push({ task_id: id, reason: 'Task not found' }); continue; }
      if (!isHeadOffice && task.vendor_id !== req.user!.vendor_id) {
        results.failed.push({ task_id: id, reason: 'Not in your vendor' }); continue;
      }
      if (task.status === 'completed') {
        results.failed.push({ task_id: id, reason: 'Task already completed' }); continue;
      }
      if (isHeadOffice) {
        // Cross-vendor allowed; retarget the task to the employee's vendor.
        const newVendorId = emp.vendor_id ?? task.vendor_id;
        await pool.query(
          `UPDATE tasks SET employee_id = $1, vendor_id = $2, assigned_at = NOW(),
             assignment_count = assignment_count + 1, updated_at = NOW() WHERE id = $3`,
          [employee_id, newVendorId, task.id]
        );
      } else {
        await pool.query(
          `UPDATE tasks SET employee_id = $1, assigned_at = NOW(),
             assignment_count = assignment_count + 1, updated_at = NOW() WHERE id = $2`,
          [employee_id, task.id]
        );
      }
      results.assigned += 1;
    } catch (e) {
      results.failed.push({ task_id: id, reason: (e as Error).message || 'Unknown error' });
    }
  }

  res.json(results);
}
