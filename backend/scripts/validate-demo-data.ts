import { pool } from '../src/config/db';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const DIR = 'D:/Signage/docs/demo-data/';
const read = (p: string): any[] => {
  const wb = XLSX.read(fs.readFileSync(p));
  return XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
};

async function main() {
  const vendors = (await pool.query('SELECT uid FROM vendors')).rows.map((r) => String(r.uid));
  const brands = (await pool.query('SELECT lower(name) n FROM brands')).rows.map((r) => r.n);
  const sizes = (await pool.query('SELECT lower(label) l FROM standard_boarding_sizes')).rows.map((r) => r.l);
  const stores = (await pool.query('SELECT lower(name) n FROM stores')).rows.map((r) => r.n);
  const emails = (await pool.query('SELECT lower(email) e FROM users')).rows.map((r) => r.e);
  const storeUids = (await pool.query('SELECT uid FROM stores WHERE uid IS NOT NULL')).rows.map((r) => String(r.uid));

  const validRoles = ['rjcorp_admin', 'rjcorp_user', 'vendor_admin', 'vendor_user', 'employee'];
  const vendorScoped = ['vendor_admin', 'vendor_user', 'employee'];
  let problems = 0;

  const s = read(DIR + 'demo_stores.xlsx');
  s.forEach((r, i) => {
    const p: string[] = [];
    if (storeUids.includes(String(r.uid))) p.push('uid already exists');
    if (stores.includes(String(r.name).toLowerCase())) p.push('name already exists');
    if (p.length) { problems++; console.log('STORE row', i + 2, r.name, '->', p.join(', ')); }
  });

  const u = read(DIR + 'demo_users.xlsx');
  u.forEach((r, i) => {
    const p: string[] = [];
    if (!validRoles.includes(String(r.role))) p.push('bad role');
    if (vendorScoped.includes(String(r.role)) && !vendors.includes(String(r.vendor_uid))) p.push('vendor_uid missing/unknown');
    if (emails.includes(String(r.email).toLowerCase())) p.push('email already exists');
    if (p.length) { problems++; console.log('USER row', i + 2, r.email, '->', p.join(', ')); }
  });

  const t = read(DIR + 'demo_tasks.xlsx');
  t.forEach((r, i) => {
    const p: string[] = [];
    if (!['recee', 'installation'].includes(String(r.task_type))) p.push('bad task_type');
    if (r.task_type === 'installation' && !['direct', 'direct_boarding'].includes(String(r.installation_type))) p.push('bad installation_type');
    if (!vendors.includes(String(r.vendor_uid))) p.push('vendor unknown');
    if (r.installation_type === 'direct_boarding') {
      if (r.brand_name && !brands.includes(String(r.brand_name).toLowerCase())) p.push('brand unknown');
      if (r.boarding_size_label && !sizes.includes(String(r.boarding_size_label).toLowerCase())) p.push('size unknown');
    }
    if (p.length) { problems++; console.log('TASK row', i + 2, r.store_name, '->', p.join(', ')); }
  });

  console.log(`Counts: stores ${s.length}, users ${u.length}, tasks ${t.length}`);
  console.log(`Problems found: ${problems}`);
  console.log('NOTE: task store_name resolves only AFTER demo_stores.xlsx is uploaded, so upload order is stores -> users -> tasks.');
  await pool.end();
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
