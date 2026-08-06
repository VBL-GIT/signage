import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePrivilege } from '../auth/privileges';
import { listRoles, createRole, updateRole, listPrivilegeCatalog } from '../controllers/roles.controller';

const router = Router();
router.use(authenticate);

// The privilege catalog is readable by anyone who can manage roles (to build the picker).
router.get('/privileges', requirePrivilege('role.manage'), listPrivilegeCatalog as any);
router.get('/', requirePrivilege('role.manage'), listRoles as any);

const roleBody = z.object({
  name: z.string().min(1),
  privileges: z.array(z.string()).default([]),
});
router.post('/', requirePrivilege('role.manage'), validate(roleBody), createRole as any);
router.patch('/:id', requirePrivilege('role.manage'), validate(z.object({
  name: z.string().min(1).optional(),
  privileges: z.array(z.string()).optional(),
})), updateRole as any);

export default router;
