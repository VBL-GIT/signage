import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';

const COLUMNS = 'a.id, a.uid, a.brand_id, b.name AS brand_name, a.name, a.image_url, a.is_active, a.created_at';

// Reference list — any authenticated user (selection dropdowns + management screen).
// Optional ?brand_id filters to one brand.
export async function listArtworks(req: AuthRequest, res: Response) {
  const { brand_id } = req.query;
  const params: unknown[] = [];
  let where = '';
  if (brand_id) { params.push(brand_id); where = 'WHERE a.brand_id = $1'; }
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
     FROM artworks a JOIN brands b ON b.id = a.brand_id
     ${where}
     ORDER BY b.name, a.name`,
    params
  );
  res.json(rows);
}

export async function createArtwork(req: AuthRequest, res: Response) {
  const { brand_id, name, image_url } = req.body as { brand_id: string; name: string; image_url?: string };
  const { rows: b } = await pool.query('SELECT id FROM brands WHERE id = $1', [brand_id]);
  if (!b[0]) { res.status(400).json({ error: 'Unknown brand' }); return; }
  try {
    const { rows } = await pool.query(
      `INSERT INTO artworks (brand_id, name, image_url) VALUES ($1, $2, $3)
       RETURNING id, code`,
      [brand_id, name.trim(), image_url || null]
    );
    const created = rows[0];
    // Auto-generate the UID from the row's numeric code (same pattern as vendors).
    const uid = `ART-${String(created.code).padStart(3, '0')}`;
    await pool.query('UPDATE artworks SET uid = $1 WHERE id = $2', [uid, created.id]);
    const { rows: full } = await pool.query(
      `SELECT ${COLUMNS} FROM artworks a JOIN brands b ON b.id = a.brand_id WHERE a.id = $1`,
      [created.id]
    );
    res.status(201).json(full[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'An artwork with this name already exists for the brand' });
      return;
    }
    throw e;
  }
}

export async function updateArtwork(req: AuthRequest, res: Response) {
  const { name, is_active, image_url } = req.body as { name?: string; is_active?: boolean; image_url?: string | null };
  const sets: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) { params.push(name.trim()); sets.push(`name = $${params.length}`); }
  if (is_active !== undefined) { params.push(is_active); sets.push(`is_active = $${params.length}`); }
  if (image_url !== undefined) { params.push(image_url || null); sets.push(`image_url = $${params.length}`); }
  if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE artworks SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
      params
    );
    if (!rows[0]) { res.status(404).json({ error: 'Artwork not found' }); return; }
    const { rows: full } = await pool.query(
      `SELECT ${COLUMNS} FROM artworks a JOIN brands b ON b.id = a.brand_id WHERE a.id = $1`,
      [rows[0].id]
    );
    res.json(full[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'An artwork with this name already exists for the brand' });
      return;
    }
    throw e;
  }
}
