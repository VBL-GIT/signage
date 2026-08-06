import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { isHeadOffice } from '../auth/privileges';

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

export async function createStore(req: AuthRequest, res: Response) {
  const { name, address, pincode, lat, long, uid, contact_no, contact_email, contact_person, vendor_id } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO stores (name, address, pincode, lat, long, uid, contact_no, contact_email, contact_person, vendor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [name, address, pincode, lat, long, uid || null, contact_no || null, contact_email || null, contact_person || null, vendor_id || null]
  );
  res.status(201).json(rows[0]);
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
