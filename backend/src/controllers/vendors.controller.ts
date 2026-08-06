import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';

const COLUMNS = 'id, uid, code, name, contact_person, contact_phone, contact_email, is_active, created_at';

export async function listVendors(_req: AuthRequest, res: Response) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM vendors ORDER BY name`);
  res.json(rows);
}

export async function createVendor(req: AuthRequest, res: Response) {
  const { uid, name, contact_person, contact_phone, contact_email } = req.body;

  const { rows: dupe } = await pool.query(
    'SELECT id FROM vendors WHERE lower(contact_email) = lower($1)', [contact_email]
  );
  if (dupe.length) { res.status(409).json({ error: 'A vendor with this email already exists' }); return; }

  try {
    const { rows } = await pool.query(
      `INSERT INTO vendors (uid, name, contact_person, contact_phone, contact_email)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING ${COLUMNS}`,
      [uid || null, name, contact_person || null, contact_phone || null, contact_email || null]
    );
    let vendor = rows[0];
    // Auto-generate a UID from the vendor's numeric code if none was supplied.
    if (!vendor.uid) {
      const generated = `VND-${String(vendor.code).padStart(3, '0')}`;
      const upd = await pool.query(
        `UPDATE vendors SET uid = $1 WHERE id = $2 RETURNING ${COLUMNS}`,
        [generated, vendor.id]
      );
      vendor = upd.rows[0];
    }
    res.status(201).json(vendor);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      const constraint = (e as { constraint?: string }).constraint;
      if (constraint === 'idx_vendors_contact_email_unique') {
        res.status(409).json({ error: 'A vendor with this email already exists' });
        return;
      }
      res.status(409).json({ error: 'A vendor with this UID already exists' });
      return;
    }
    throw e;
  }
}

// Edit a vendor's details (RJCorp admin — vendor.manage).
export async function updateVendor(req: AuthRequest, res: Response) {
  const { name, contact_person, contact_phone, contact_email } = req.body as {
    name?: string; contact_person?: string; contact_phone?: string; contact_email?: string;
  };
  if (contact_email !== undefined && contact_email.trim()) {
    const { rows: dupe } = await pool.query(
      'SELECT id FROM vendors WHERE lower(contact_email) = lower($1) AND id != $2',
      [contact_email.trim(), req.params.id]
    );
    if (dupe.length) { res.status(409).json({ error: 'A vendor with this email already exists' }); return; }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (name !== undefined) add('name', name.trim());
  if (contact_person !== undefined) add('contact_person', contact_person.trim() || null);
  if (contact_phone !== undefined) add('contact_phone', contact_phone.trim() || null);
  if (contact_email !== undefined) add('contact_email', contact_email.trim() || null);
  if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE vendors SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params
    );
    if (!rows[0]) { res.status(404).json({ error: 'Vendor not found' }); return; }
    res.json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'A vendor with this email already exists' });
      return;
    }
    throw e;
  }
}

// RJCorp admin activates / deactivates a vendor.
export async function setVendorActive(req: AuthRequest, res: Response) {
  const { is_active } = req.body as { is_active: boolean };
  const { rows } = await pool.query(
    `UPDATE vendors SET is_active = $1 WHERE id = $2 RETURNING ${COLUMNS}`,
    [is_active, req.params.id]
  );
  if (!rows[0]) { res.status(404).json({ error: 'Vendor not found' }); return; }
  res.json(rows[0]);
}
