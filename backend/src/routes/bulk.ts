import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePrivilege } from '../auth/privileges';
import { bulkUsers, bulkTasks, bulkStores, bulkVendors } from '../controllers/bulk.controller';

const router = Router();
router.use(authenticate);

const fileBody = z.object({ file_url: z.string().url() });
// Tasks are uploaded per type via separate templates: `kind` fixes the task type
// for every row (so the template omits task_type/installation_type columns).
const taskFileBody = z.object({
  file_url: z.string().url(),
  kind: z.enum(['recee', 'direct', 'direct_boarding']).optional(),
});

// Each bulk channel maps to the same privilege as creating that entity individually.
router.post('/users', requirePrivilege('user.manage'), validate(fileBody), bulkUsers as any);
router.post('/tasks', requirePrivilege('task.create'), validate(taskFileBody), bulkTasks as any);
router.post('/stores', requirePrivilege('store.manage'), validate(fileBody), bulkStores as any);
router.post('/vendors', requirePrivilege('vendor.manage'), validate(fileBody), bulkVendors as any);

export default router;
