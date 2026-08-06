import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePrivilege } from '../auth/privileges';
import { listStores, getStore, createStore, assignEmployee, removeAssignment } from '../controllers/stores.controller';

const router = Router();

router.use(authenticate);
router.get('/', listStores as any);
router.get('/:id', getStore as any);
router.post('/', requirePrivilege('store.manage'), validate(z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  pincode: z.string().min(1),
  lat: z.number(),
  long: z.number(),
  uid: z.string().min(1).optional(),
  contact_no: z.string().min(1).optional(),
  contact_email: z.string().email().optional(),
  contact_person: z.string().min(1).optional(),
  vendor_id: z.string().uuid().optional(),
})), createStore as any);
router.post('/:id/assignments', requireRole('rjcorp_admin', 'vendor_admin'), validate(z.object({ employee_id: z.string().uuid() })), assignEmployee as any);
router.delete('/:id/assignments/:employee_id', requireRole('rjcorp_admin', 'vendor_admin'), removeAssignment as any);

export default router;
