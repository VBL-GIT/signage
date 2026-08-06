import { pool } from '../src/config/db';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const str = (v: unknown): string => (v === undefined || v === null) ? '' : String(v).trim();

async function main() {
  console.log('global fetch available:', typeof (globalThis as any).fetch === 'function');

  const buf = fs.readFileSync('D:/Signage/docs/demo-data/demo_stores.xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  console.log('parsed rows:', rows.length);
  console.log('first row keys:', Object.keys(rows[0]));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;
    const failed: any[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const name = str(r.name), address = str(r.address), pincode = str(r.pincode);
        const lat = parseFloat(str(r.lat)), long = parseFloat(str(r.long));
        if (!name || !address || !pincode) throw new Error('name, address and pincode are required');
        if (isNaN(lat) || isNaN(long)) throw new Error('lat and long must be numbers');
        await client.query(
          'INSERT INTO stores (name, address, pincode, lat, long, uid, contact_no) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [name, address, pincode, lat, long, str(r.uid) || null, str(r.contact_no) || null]
        );
        inserted++;
      } catch (e: any) {
        failed.push({ row: i + 2, reason: e.code === '23505' ? 'Store UID already exists' : (e.message || 'Unknown') });
      }
    }
    console.log('DRY RUN result -> inserted:', inserted, 'failed:', JSON.stringify(failed));
    await client.query('ROLLBACK');
    console.log('(rolled back — no rows actually saved)');
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
