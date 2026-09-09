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
    uid: z.string().optional(), // auto-generated from code when omitted
    // COMPANY_NAME is the only thing a vendor master cannot be created without:
    // it is the handle the console and the task importer resolve vendors by.
    name: z.string().min(1),
    // The contact details may all be blank. A form posts every input it draws,
    // so an untouched one arrives as "" — `.min(1)` rejected exactly that and
    // made an optional field mandatory in practice. validateOptionalEmail() in
    // createVendor still applies the full syntax + typo rules to an address
    // that IS given.
    contact_person: z.string().optional(),
    contact_phone: z.string().optional(),
    contact_email: z.string().optional(),
    // Free-text operator note. Optional, and never used in a business rule.
    remarks: z.string().max(2000).optional(),
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
    remarks: z.string().max(2000).optional(),
  })),
  updateVendor as any);

export default router;
