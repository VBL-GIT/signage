import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { generatePresignedUploadUrl } from '../src/services/storage.service';
import { env } from '../src/config/env';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function main() {
  console.log('Bucket:', env.SUPABASE_STORAGE_BUCKET);
  const file = 'D:/Signage/docs/demo-data/demo_stores.xlsx';
  const body = fs.readFileSync(file);

  console.log('1) presign...');
  const { upload_url, public_url, key } = await generatePresignedUploadUrl(`test_${Date.now()}.xlsx`, XLSX_MIME);
  console.log('   key:', key);
  console.log('   public_url:', public_url);

  console.log('2) PUT to storage (signed upload url)...');
  const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': XLSX_MIME }, body });
  console.log('   PUT status:', put.status, put.statusText);
  if (!put.ok) { console.log('   PUT body:', await put.text()); }

  console.log('3) fetch public_url back...');
  const get = await fetch(public_url);
  console.log('   GET status:', get.status, get.statusText);
  if (!get.ok) { console.log('   GET body:', await get.text()); process.exit(1); }

  const buf = Buffer.from(await get.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  console.log('4) parsed', rows.length, 'rows from the downloaded file. ROUND TRIP OK.');
}
main().catch((e) => { console.error('FATAL', e?.message || e); process.exit(1); });
