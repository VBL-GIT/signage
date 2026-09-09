/**
 * Clear out test traffic before a real launch.
 *
 * DELETES the Stores and Tasks bulk sections and everything hanging off a task:
 * tasks, task_steps, task_step_photos, task_signage_plan, follow_ups,
 * store_assignments, stores.
 *
 * KEEPS every account (employees, vendor staff, head office), every vendor, and
 * the reference data (brands, artworks, standard board sizes, custom roles).
 * Sessions are kept too, so nobody is logged out — pass --sessions to clear
 * those as well.
 *
 * Photo FILES in Supabase Storage are NOT touched. Their rows go, so they are
 * orphaned and cost only storage; clearing the bucket is a separate job.
 *
 * Requires --yes. Run inside one transaction: any failure leaves the database
 * exactly as it was.
 *
 *   npx ts-node scripts/wipe-test-data.ts            # dry run, prints counts
 *   npx ts-node scripts/wipe-test-data.ts --yes
 *   npx ts-node scripts/wipe-test-data.ts --yes --sessions
 *
 * TAKE A BACKUP FIRST. pg_dump "$DATABASE_URL" -f backup.sql
 */
import { pool } from '../src/config/db';

// Children before parents. task_step_photos hangs off task_steps, which hangs
// off tasks, so the order matters even where a cascade exists.
const TARGETS = [
  'task_step_photos',
  'task_steps',
  'task_signage_plan',
  'follow_ups',
  'tasks',
  'store_assignments',
  'stores',
];
const SESSION_TARGETS = ['refresh_tokens', 'password_reset_tokens'];
const KEPT = ['users', 'vendors', 'brands', 'artworks', 'standard_boarding_sizes', 'roles'];

async function counts(tables: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    out[t] = rows[0].n;
  }
  return out;
}

async function main() {
  const yes = process.argv.includes('--yes');
  const alsoSessions = process.argv.includes('--sessions');
  const targets = alsoSessions ? [...TARGETS, ...SESSION_TARGETS] : TARGETS;

  const before = await counts([...targets, ...KEPT]);
  console.log('to be DELETED:');
  for (const t of targets) console.log(`  ${t.padEnd(22)} ${before[t]}`);
  console.log('to be KEPT:');
  for (const t of KEPT) console.log(`  ${t.padEnd(22)} ${before[t]}`);

  if (!yes) {
    console.log('\nDry run — nothing deleted. Re-run with --yes to apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of targets) {
      const r = await client.query(`DELETE FROM "${t}"`);
      console.log(`  deleted ${String(r.rowCount).padStart(5)} from ${t}`);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nROLLED BACK — nothing was deleted:', (e as Error).message);
    process.exitCode = 1;
    client.release();
    await pool.end();
    return;
  }
  client.release();

  const after = await counts([...targets, ...KEPT]);
  console.log('\nafter:');
  for (const t of targets) console.log(`  ${t.padEnd(22)} ${after[t]}`);
  for (const t of KEPT) console.log(`  ${t.padEnd(22)} ${after[t]}  (kept)`);
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
