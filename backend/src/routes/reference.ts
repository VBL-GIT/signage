import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePrivilege } from '../auth/privileges';
import { listBrands, createBrand, listBoardingSizes, listUsers, createUser, updateUser, setUserActive, setUserRole, deleteEmployee } from '../controllers/reference.controller';

const router = Router();
router.use(authenticate);

router.get('/brands', listBrands as any);
router.post('/brands',
  requirePrivilege('artwork.manage'),
  validate(z.object({ name: z.string().min(1).max(120) })),
  createBrand as any);
router.get('/boarding-sizes', listBoardingSizes as any);

router.get('/users',
  requireRole('rjcorp_admin', 'rjcorp_user', 'vendor_admin', 'vendor_user'),
  listUsers as any);

router.post('/users',
  requirePrivilege('user.manage'),
  validate(z.object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['rjcorp_admin', 'rjcorp_user', 'vendor_admin', 'vendor_user', 'employee']),
    mobile: z.string().optional(),
    vendor_id: z.string().uuid().optional(),
    custom_role_id: z.string().uuid().optional(),
  })), createUser as any);

router.patch('/users/:id/status',
  requirePrivilege('user.status'),
  validate(z.object({ is_active: z.boolean() })),
  setUserActive as any);

router.patch('/users/:id',
  requirePrivilege('user.manage'),
  validate(z.object({
    first_name: z.string().min(1).optional(),
    last_name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    mobile: z.string().optional(),
  })),
  updateUser as any);

router.patch('/users/:id/role',
  requirePrivilege('role.manage'),
  validate(z.object({ custom_role_id: z.string().uuid().nullable() })),
  setUserRole as any);

// Dev/test cleanup only — hard-deletes an employee account and cascades to
// their tasks/history. See deleteEmployee's doc comment.
router.delete('/users/:id',
  requirePrivilege('user.manage'),
  deleteEmployee as any);

export default router;
