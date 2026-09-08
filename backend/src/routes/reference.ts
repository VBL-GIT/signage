import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePrivilege } from '../auth/privileges';
import { listBrands, createBrand, listBoardingSizes, listUsers, createUser, updateUser, setUserActive, setUserRole, deleteEmployee, getUserPassword } from '../controllers/reference.controller';

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
    // Shape only — validateEmail() in the controller trims, lower-cases and
    // applies the syntax/typo rules. Zod's .email() would reject a padded
    // address outright, so the trim could never happen and the manual endpoint
    // would disagree with the bulk importer, which trims.
    email: z.string().min(1),
    // INTERIM — outbound email is not deliverable yet (no verified Resend
    // domain). Normally the initial password is generated server-side and
    // emailed, and this field is left empty. While mail cannot be delivered an
    // admin may set one here instead: without it a new account is unreachable,
    // because Forgot Password needs email too and there is no change-password
    // screen. Optional — omit it and the generate-and-email path runs unchanged,
    // so this reverts by simply going unused once the domain is verified.
    password: z.string().min(8).max(128).optional(),
    role: z.enum(['rjcorp_admin', 'rjcorp_user', 'vendor_admin', 'vendor_user', 'employee']),
    mobile: z.string().optional(),
    vendor_id: z.string().uuid().optional(),
    custom_role_id: z.string().uuid().optional(),
  })), createUser as any);

// Reveal one account's password. Authorisation is inside the controller,
// because it depends on the TARGET user (own vendor or not), which a static
// role/privilege guard on the route cannot see. requireRole here is only a
// cheap first gate — it is not the real check.
router.get('/users/:id/password',
  requireRole('rjcorp_admin', 'vendor_admin'),
  getUserPassword as any);

router.patch('/users/:id/status',
  requirePrivilege('user.status'),
  validate(z.object({ is_active: z.boolean() })),
  setUserActive as any);

router.patch('/users/:id',
  requirePrivilege('user.manage'),
  validate(z.object({
    first_name: z.string().min(1).optional(),
    last_name: z.string().min(1).optional(),
    // Shape only; validateEmail() in updateUser does the real check.
    email: z.string().min(1).optional(),
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
