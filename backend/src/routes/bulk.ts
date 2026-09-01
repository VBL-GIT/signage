import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePrivilege } from '../auth/privileges';
import { bulkUsers, bulkTasks, bulkStores, bulkVendors } from '../controllers/bulk.controller';

const router = Router();
router.use(authenticate);

const fileBody = z.object({ file_url: z.string().url() });
// Stores accept two sheet layouts: the compact operational template (default)
// and VBL's 56-column customer-master export. Same endpoint, same privilege,
// same business rules — only the column mapping differs.
const storeFileBody = z.object({
  file_url: z.string().url(),
  format: z.enum(['compact', 'customer_master']).optional(),
});
// Tasks are uploaded per type via separate templates: `kind` fixes the task type
// for every row (so the template omits task_type/installation_type columns).
const taskFileBody = z.object({
  file_url: z.string().url(),
  kind: z.enum(['recee', 'direct', 'direct_boarding']).optional(),
});

// Each bulk channel maps to the same privilege as creating that entity individually.
router.post('/users', requirePrivilege('user.manage'), validate(fileBody), bulkUsers as any);
router.post('/tasks', requirePrivilege('task.create'), validate(taskFileBody), bulkTasks as any);
router.post('/stores', requirePrivilege('store.manage'), validate(storeFileBody), bulkStores as any);
router.post('/vendors', requirePrivilege('vendor.manage'), validate(fileBody), bulkVendors as any);

export default router;
