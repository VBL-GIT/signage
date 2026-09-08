import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { isHeadOffice } from '../auth/privileges';
import {
  STORE_COLUMNS,
  loadStoreIdentityLookup,
  normalizeStoreInput,
  resolveStoreIdentity,
  storeConflictMessage,
  upsertStore,
} from '../services/stores.service';

export async function listStores(req: AuthRequest, res: Response) {
  const user = req.user!;
  let rows;
  if (user.role === 'employee') {
    const result = await pool.query(
      `SELECT s.* FROM stores s
       JOIN store_assignments sa ON sa.store_id = s.id
       WHERE sa.employee_id = $1 AND sa.is_active = true
       ORDER BY s.name`,
      [user.id]
    );
    rows = result.rows;
  } else if (isHeadOffice(user.role)) {
    const result = await pool.query(
      `SELECT s.*, v.name as vendor_name FROM stores s
       LEFT JOIN vendors v ON v.id = s.vendor_id
       ORDER BY s.name`
    );
    rows = result.rows;
  } else {
    // vendor_admin / vendor_user: only their own vendor's stores.
    const result = await pool.query(
      `SELECT s.*, v.name as vendor_name FROM stores s
       LEFT JOIN vendors v ON v.id = s.vendor_id
       WHERE s.vendor_id = $1
       ORDER BY s.name`,
      [user.vendor_id]
    );
    rows = result.rows;
  }
  res.json(rows);
}

export async function getStore(req: AuthRequest, res: Response) {
  const user = req.user!;
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT s.*, v.name as vendor_name FROM stores s
     LEFT JOIN vendors v ON v.id = s.vendor_id
     WHERE s.id = $1`,
    [id]
  );
  const store = rows[0];
  if (!store) { res.status(404).json({ error: 'Store not found' }); return; }
  // Vendor staff / employees may only read stores mapped to their own vendor.
  if (!isHeadOffice(user.role) && store.vendor_id !== user.vendor_id) {
    res.status(403).json({ error: 'You do not have access to this store' }); return;
  }
  res.json(store);
}

/**
 * Create a store, or update the existing one when its Customer Code is already
 * known. Customer Code is the business key: found => update that store in place
 * (same stores.id, so tasks and assignments keep pointing at it), not found =>
 * create. Same rule as the bulk importer, via the same service.
 */
export async function createStore(req: AuthRequest, res: Response) {
  const { input, errors } = normalizeStoreInput(req.body, { requireContactEmail: true, requireMetadata: true });
  if (errors.length) {
    res.status(400).json({ error: errors[0], details: errors });
    return;
  }

  const lookup = await loadStoreIdentityLookup();
  const identity = resolveStoreIdentity(lookup, input.customer_code, input.uid);
  if (!identity.ok) {
    res.status(409).json({ error: identity.reason });
    return;
  }

  try {
    const { store, outcome } = await upsertStore(pool, input, identity.targetId);
    res.status(outcome === 'created' ? 201 : 200).json({ ...store, outcome });
  } catch (e) {
    const msg = storeConflictMessage(e);
    if (msg) { res.status(409).json({ error: msg }); return; }
    throw e;
  }
}

/**
 * Edit an existing store by id (the web console's Store edit form).
 *
 * Partial: the body is merged over the stored row before validation, so a
 * caller can send just the fields they changed. Changing customer_code/uid to a
 * value another store already owns is refused rather than silently merging the
 * two records.
 */
export async function updateStore(req: AuthRequest, res: Response) {
  const id = String(req.params.id);
  const { rows: existingRows } = await pool.query(
    `SELECT ${STORE_COLUMNS} FROM stores WHERE id = $1`,
    [id]
  );
  const existing = existingRows[0];
  if (!existing) { res.status(404).json({ error: 'Store not found' }); return; }

  // Vendor mapping is its own operation, not a row edit: map/unmap the store's
  // vendor without re-validating the whole record. This matters because every
  // store created before Customer Code existed has customer_code NULL — running
  // the full row validation would refuse to map a vendor to any of them until
  // someone first backfilled a Customer Code, which would make the mapping
  // control useless exactly where it is needed most.
  const keys = Object.keys(req.body);
  if (keys.length === 1 && keys[0] === 'vendor_id') {
    await pool.query(
      'UPDATE stores SET vendor_id = $1, updated_at = NOW() WHERE id = $2',
      [(req.body as { vendor_id: string | null }).vendor_id ?? null, id]
    );
    // Re-read with the vendor name so the client can render the new mapping
    // without a second round-trip.
    const { rows } = await pool.query(
      `SELECT s.*, v.name AS vendor_name FROM stores s
       LEFT JOIN vendors v ON v.id = s.vendor_id WHERE s.id = $1`,
      [id]
    );
    res.json({ ...rows[0], outcome: 'updated' });
    return;
  }

  // Merge over the current row so unspecified fields keep their stored value.
  // vendor_id is only carried through when the caller actually sent it, so an
  // edit from the (vendor-less) store form never unmaps the store.
  const merged: Record<string, unknown> = {
    customer_code: existing.customer_code,
    uid: existing.uid,
    name: existing.name,
    address: existing.address,
    pincode: existing.pincode,
    lat: existing.lat,
    long: existing.long,
    contact_no: existing.contact_no,
    contact_email: existing.contact_email,
    contact_person: existing.contact_person,
    outlet_status: existing.outlet_status,
    // Carry the stored context columns through, so an edit that does not touch
    // them satisfies the same requirement the create path applies rather than
    // failing on values the caller never intended to change.
    source_metadata: existing.source_metadata,
    ...req.body,
  };

  const { input, errors } = normalizeStoreInput(merged, { requireContactEmail: true, requireMetadata: true });
  if (errors.length) {
    res.status(400).json({ error: errors[0], details: errors });
    return;
  }

  const lookup = await loadStoreIdentityLookup();
  const identity = resolveStoreIdentity(lookup, input.customer_code, input.uid);
  if (!identity.ok) { res.status(409).json({ error: identity.reason }); return; }
  if (identity.targetId && identity.targetId !== id) {
    res.status(409).json({
      error: 'Another store already uses this Customer Code or Store UID',
    });
    return;
  }

  try {
    const { store } = await upsertStore(pool, input, id);
    res.json({ ...store, outcome: 'updated' });
  } catch (e) {
    const msg = storeConflictMessage(e);
    if (msg) { res.status(409).json({ error: msg }); return; }
    throw e;
  }
}

export async function assignEmployee(req: AuthRequest, res: Response) {
  const { id: store_id } = req.params;
  const { employee_id } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO store_assignments (store_id, employee_id)
     VALUES ($1, $2)
     ON CONFLICT (store_id, employee_id) DO UPDATE SET is_active = true
     RETURNING *`,
    [store_id, employee_id]
  );
  res.status(201).json(rows[0]);
}

export async function removeAssignment(req: AuthRequest, res: Response) {
  const { id: store_id, employee_id } = req.params;
  await pool.query(
    'UPDATE store_assignments SET is_active = false WHERE store_id = $1 AND employee_id = $2',
    [store_id, employee_id]
  );
  res.json({ message: 'Assignment removed' });
}
