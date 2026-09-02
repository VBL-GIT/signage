import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePrivilege } from '../auth/privileges';
import { listVendors, createVendor, updateVendor, setVendorActive } from '../controllers/vendors.controller';

const router = Router();
router.use(authenticate);

router.get('/', requireRole('rjcorp_admin', 'rjcorp_user'), listVendors as any);

router.post('/',
  requirePrivilege('vendor.manage'),
  validate(z.object({
    uid: z.string().min(1).optional(), // auto-generated from code when omitted
    name: z.string().min(1),
    contact_person: z.string().min(1),
    contact_phone: z.string().min(1),
    // Shape only; validateEmail() in createVendor trims and validates.
    contact_email: z.string().min(1),
  })), createVendor as any);

router.patch('/:id/status',
  requirePrivilege('vendor.status'),
  validate(z.object({ is_active: z.boolean() })),
  setVendorActive as any);

router.patch('/:id',
  requirePrivilege('vendor.manage'),
  validate(z.object({
    name: z.string().min(1).optional(),
    contact_person: z.string().optional(),
    contact_phone: z.string().optional(),
    // Shape only; validateEmail() in updateVendor validates a non-empty value,
    // and an empty string still means "clear this field".
    contact_email: z.string().optional(),
  })),
  updateVendor as any);

export default router;
