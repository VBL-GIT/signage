import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePrivilege } from '../auth/privileges';
import { listTasks, getTask, createTask, assignTask, assignBulk } from '../controllers/tasks.controller';
import {
  submitRecee,
  approveRecee,
  approveBulk,
  submitInstallation,
} from '../controllers/taskSteps.controller';

const router = Router();
router.use(authenticate);

const SIGNAGE_TYPES = ['nonlit', 'glow_sign_board', 'impact'] as const;

// Recee: employee captures 1-5 signages, each editable (size + type).
const receeSignageSchema = z.array(z.object({
  photo_url: z.string().url(),
  lat: z.number(),
  long: z.number(),
  signage_type: z.enum(SIGNAGE_TYPES),
  boarding_size_id: z.string().uuid().optional(),
  custom_width_cm: z.number().int().positive().optional(),
  custom_height_cm: z.number().int().positive().optional(),
  distance_from_store_m: z.number().optional(),
  distance_from_first_m: z.number().optional(),
  marker_x: z.number().min(0).max(1).optional(),
  marker_y: z.number().min(0).max(1).optional(),
  annotation: z.string().max(200000).optional(),
})).min(1).max(5);

// Boarding install: one photo per planned signage (specs come from the plan).
const installSignageSchema = z.array(z.object({
  signage_index: z.number().int().positive(),
  photo_url: z.string().url(),
  lat: z.number(),
  long: z.number(),
  distance_from_store_m: z.number().optional(),
  distance_from_first_m: z.number().optional(),
  distance_from_recee_m: z.number().optional(),
})).min(1).max(5);

router.get('/', listTasks as any);

// Bulk approve/reject recee tasks. Declared before '/:id' routes (it's a fixed
// path, so no conflict, but kept explicit).
router.post('/approve-bulk', requirePrivilege('task.approve'), validate(z.object({
  action: z.enum(['approve', 'reject']),
  task_ids: z.array(z.string().uuid()).min(1).max(200),
  brand_id: z.string().uuid().optional(),
  artwork_id: z.string().uuid().optional(),
  rejection_reason: z.string().optional(),
})), approveBulk as any);

// Bulk assign/reassign tasks to one employee. Fixed path — declared before '/:id'.
router.post('/assign-bulk', requirePrivilege('task.assign'), validate(z.object({
  task_ids: z.array(z.string().uuid()).min(1).max(200),
  employee_id: z.string().uuid(),
})), assignBulk as any);

router.get('/:id', getTask as any);
router.post('/', requirePrivilege('task.create'), validate(z.object({
  task_type: z.enum(['recee', 'installation']),
  installation_type: z.enum(['post_recee', 'direct', 'direct_boarding']).optional(),
  vendor_id: z.string().uuid(),
  store_id: z.string().uuid().optional(),
  employee_id: z.string().uuid().optional(),
  supervisor_id: z.string().uuid().optional(),
  brand_id: z.string().uuid().optional(),
  artwork_id: z.string().uuid().optional(),
  boarding_size_id: z.string().uuid().optional(),
  custom_width_cm: z.number().int().positive().optional(),
  custom_height_cm: z.number().int().positive().optional(),
  signage_type: z.enum(SIGNAGE_TYPES).optional(),
  pincode: z.string().optional(),
  target_pamphlet_count: z.number().int().positive().optional(),
})), createTask as any);

router.post('/:id/assign', requirePrivilege('task.assign'), validate(z.object({
  employee_id: z.string().uuid(),
})), assignTask as any);

router.post('/:id/recee', validate(z.object({
  notes: z.string().optional(),
  signages: receeSignageSchema,
})), submitRecee as any);

router.post('/:id/approve', requirePrivilege('task.approve'), validate(z.object({
  approval_status: z.enum(['approved', 'rejected']),
  rejection_reason: z.string().optional(),
  // Per-signage confirmation: one entry per recee signage (brand + size each).
  signages: z.array(z.object({
    signage_index: z.number().int().positive(),
    brand_id: z.string().uuid(),
    artwork_id: z.string().uuid().optional(),
    boarding_size_id: z.string().uuid().optional(),
    custom_width_cm: z.number().int().positive().optional(),
    custom_height_cm: z.number().int().positive().optional(),
  })).min(1).max(5).optional(),
})), approveRecee as any);

router.post('/:id/install', validate(z.object({
  // Pamphlet ('direct') fields: one photo per drop point, each with its own
  // GPS, store/area and brand. Count is derived from the number of photos.
  lat: z.number().optional(),
  long: z.number().optional(),
  notes: z.string().optional(),
  photos: z.array(z.object({
    photo_url: z.string().url(),
    lat: z.number().optional(),
    long: z.number().optional(),
    area_label: z.string().max(300).optional(),
    brand_label: z.string().max(200).optional(),
  })).optional(),
  pamphlet_count: z.number().int().nonnegative().optional(),
  pincode: z.string().optional(),
  // Boarding install fields:
  signages: installSignageSchema.optional(),
})), submitInstallation as any);

export default router;
