import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePrivilege } from '../auth/privileges';
import { listStores, getStore, createStore, updateStore, assignEmployee, removeAssignment } from '../controllers/stores.controller';

const router = Router();

// Shape only — business rules (Customer Code upsert, email syntax, coordinate
// ranges) live in stores.service so manual and bulk creation share them.
// Coordinates accept a number or a numeric string: the web form sends numbers,
// spreadsheet-derived callers send strings.
const coord = z.union([z.number(), z.string().min(1)]);

router.use(authenticate);
router.get('/', listStores as any);
router.get('/:id', getStore as any);
router.post('/', requirePrivilege('store.manage'), validate(z.object({
  // Customer Code and Store UID are both mandatory for new stores. Existing
  // rows predating them stay valid — the requirement is enforced here, at the
  // API layer, rather than as a NOT NULL that legacy data would fail.
  customer_code: z.string().min(1),
  uid: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  pincode: z.string().min(1),
  lat: coord,
  long: coord,
  contact_no: z.string().min(1).optional(),
  contact_email: z.string().min(1).optional(),
  contact_person: z.string().min(1).optional(),
  outlet_status: z.string().optional(),
  // Retained (not required): stores keep their vendor relationship, the store
  // creation form just no longer asks for it. New stores may have vendor_id NULL.
  vendor_id: z.string().uuid().optional(),
})), createStore as any);

router.patch('/:id', requirePrivilege('store.manage'), validate(z.object({
  customer_code: z.string().min(1).optional(),
  uid: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  pincode: z.string().min(1).optional(),
  lat: coord.optional(),
  long: coord.optional(),
  contact_no: z.string().optional(),
  contact_email: z.string().optional(),
  contact_person: z.string().optional(),
  outlet_status: z.string().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
})), updateStore as any);
router.post('/:id/assignments', requireRole('rjcorp_admin', 'vendor_admin'), validate(z.object({ employee_id: z.string().uuid() })), assignEmployee as any);
router.delete('/:id/assignments/:employee_id', requireRole('rjcorp_admin', 'vendor_admin'), removeAssignment as any);

export default router;
