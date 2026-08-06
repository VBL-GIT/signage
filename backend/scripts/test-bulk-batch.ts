import { pool } from '../src/config/db';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const str = (v: unknown) => (v == null ? '' : String(v).trim());

// Replicate the controller's chunked multi-row insert to validate the SQL it generates.
async function chunkedInsert(client: any, table: string, columns: string[], valueRows: unknown[][], conflict = '', returning = 'id') {
  const ncols = columns.length; const out: any[] = []; const CHUNK = 500;
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    const chunk = valueRows.slice(i, i + CHUNK);
    const ph = chunk.map((_, ri) => `(${columns.map((__, ci) => `$${ri * ncols + ci + 1}`).join(',')})`).join(',');
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${ph} ${conflict} RETURNING ${returning}`;
    const r = await client.query(sql, chunk.flat());
    out.push(...r.rows);
  }
  return out;
}

async function main() {
  const buf = fs.readFileSync('D:/Signage/docs/demo-data/demo_stores.xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });

  const vById = new Map<string, string>();
  for (const v of (await pool.query('SELECT id, uid FROM vendors')).rows) vById.set(String(v.uid), v.id);

  const tuples = rows.map((r) => [
    str(r.name), str(r.address), str(r.pincode), parseFloat(str(r.lat)), parseFloat(str(r.long)),
    str(r.uid) || null, str(r.contact_no) || null, str(r.contact_email) || null, str(r.contact_person) || null,
    str(r.vendor_uid) ? vById.get(str(r.vendor_uid)) ?? null : null,
  ]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await chunkedInsert(
      client, 'stores',
      ['name', 'address', 'pincode', 'lat', 'long', 'uid', 'contact_no', 'contact_email', 'contact_person', 'vendor_id'],
      tuples, 'ON CONFLICT (uid) DO NOTHING', 'id'
    );
    console.log(`Parsed ${rows.length} rows; multi-row INSERT returned ${out.length} ids (ON CONFLICT skips existing uids).`);
    await client.query('ROLLBACK');
    console.log('Rolled back — nothing persisted. SQL generation OK.');
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
