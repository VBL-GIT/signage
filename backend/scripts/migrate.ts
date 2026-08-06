import fs from 'fs';
import path from 'path';
import { pool } from '../src/config/db';

/**
 * Applies every SQL file in src/db/migrations in filename order, exactly once.
 * Tracks applied files in a `_migrations` table so it is safe to run on every
 * deploy (already-applied files are skipped). Each file runs in its own
 * transaction; a failure rolls that file back and aborts the run.
 *
 * Usage: npm run migrate
 */
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Schema migrations only. The *_seeds*.sql files contain DEMO accounts with a
  // public password hash and must never run in production — reference data is
  // loaded separately via `npm run seed:reference`.
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !/seed/i.test(f))
    .sort();
  const { rows } = await pool.query('SELECT filename FROM _migrations');
  const applied = new Set(rows.map((r) => r.filename));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) { console.log(`= skip ${file} (already applied)`); continue; }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`+ applied ${file}`);
      ran++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`! failed ${file}:`, (e as Error).message);
      throw e;
    } finally {
      client.release();
    }
  }

  console.log(ran ? `\nDone. Applied ${ran} migration(s).` : '\nDone. Database already up to date.');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
