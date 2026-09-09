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
  // Shape only, and every field optional: which fields are MANDATORY is
  // decided by normalizeStoreInput, which matches column names on spelling
  // alone and reports each missing one by its template name (CUST_CD,
  // CUST_NAME, ...). Requiring them here instead would reject a body that
  // names its fields the way the template does, and would report
  // "customer_code" for a column the operator knows as CUST_CD.
  customer_code: z.string().optional(),
  CUST_CD: z.string().optional(),
  // No longer collected: normalizeStoreInput defaults it to the customer code.
  // Still accepted so an older client or spreadsheet can set it explicitly.
  uid: z.string().min(1).optional(),
  name: z.string().optional(),
  CUST_NAME: z.string().optional(),
  address: z.string().min(1).optional(),
  // The store form collects the same columns as the store template, so the
  // address arrives as ADDR_1..ADDR_5 and the four context columns as their
  // own fields. ADDR_2..ADDR_5 stay optional: real addresses are rarely five
  // lines. normalizeStoreInput joins the parts and files the context columns
  // into source_metadata.
  ADDR_1: z.string().optional(),
  ADDR_2: z.string().optional(),
  ADDR_3: z.string().optional(),
  ADDR_4: z.string().optional(),
  ADDR_5: z.string().optional(),
  HOS: z.string().optional(),
  STATE_CD: z.string().optional(),
  CHANNEL: z.string().optional(),
  SUB_CHANNEL: z.string().optional(),
  // Older clients spelled this State_CD. Both are declared so either passes
  // validation; normalizeStoreInput matches them case-insensitively anyway.
  State_CD: z.string().optional(),
  pincode: z.string().optional(),
  ADDR_POSTAL: z.string().optional(),
  lat: coord.optional(),
  long: coord.optional(),
  LATITUDE: coord.optional(),
  LONGITUDE: coord.optional(),
  contact_no: z.string().min(1).optional(),
  contact_email: z.string().min(1).optional(),
  contact_person: z.string().min(1).optional(),
  outlet_status: z.string().optional(),
  // Retained (not required): stores keep their vendor relationship, the store
  // creation form just no longer asks for it. New stores may have vendor_id NULL.
  vendor_id: z.string().uuid().optional(),
  // Zod strips keys it does not know, which silently dropped a column whose
  // header was cased differently (STATE_CD vs State_CD) and then reported it
  // as missing. Passing unknown keys through lets normalizeStoreInput do the
  // matching, where case and punctuation are ignored and only spelling counts.
}).passthrough()), createStore as any);

router.patch('/:id', requirePrivilege('store.manage'), validate(z.object({
  customer_code: z.string().min(1).optional(),
  uid: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  // The store form collects the same columns as the store template, so the
  // address arrives as ADDR_1..ADDR_5 and the four context columns as their
  // own fields. ADDR_2..ADDR_5 stay optional: real addresses are rarely five
  // lines. normalizeStoreInput joins the parts and files the context columns
  // into source_metadata.
  ADDR_1: z.string().optional(),
  ADDR_2: z.string().optional(),
  ADDR_3: z.string().optional(),
  ADDR_4: z.string().optional(),
  ADDR_5: z.string().optional(),
  HOS: z.string().optional(),
  STATE_CD: z.string().optional(),
  CHANNEL: z.string().optional(),
  SUB_CHANNEL: z.string().optional(),
  // Older clients spelled this State_CD. Both are declared so either passes
  // validation; normalizeStoreInput matches them case-insensitively anyway.
  State_CD: z.string().optional(),
  pincode: z.string().min(1).optional(),
  lat: coord.optional(),
  long: coord.optional(),
  contact_no: z.string().optional(),
  contact_email: z.string().optional(),
  contact_person: z.string().optional(),
  outlet_status: z.string().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  // Passed through for the same reason as the create schema above.
}).passthrough()), updateStore as any);
router.post('/:id/assignments', requireRole('rjcorp_admin', 'vendor_admin'), validate(z.object({ employee_id: z.string().uuid() })), assignEmployee as any);
router.delete('/:id/assignments/:employee_id', requireRole('rjcorp_admin', 'vendor_admin'), removeAssignment as any);

export default router;
