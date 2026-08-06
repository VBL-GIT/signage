import fs from 'fs';
import path from 'path';
import { pool } from '../src/config/db';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: ts-node scripts/run-sql.ts <path-to-sql>');
    process.exit(1);
  }
  const sql = fs.readFileSync(path.resolve(file), 'utf8');
  console.log(`Running ${file} ...`);
  await pool.query(sql);
  console.log('Done.');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
