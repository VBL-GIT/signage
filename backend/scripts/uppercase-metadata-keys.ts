/**
 * One-off backfill: re-key every stores.source_metadata object so its column
 * names are canonical ALL-CAPS (State_CD -> STATE_CD, "cust cd" -> CUST_CD).
 *
 * source_metadata is the only place a spreadsheet's own column NAMES are stored
 * in the database, and rows imported before the all-caps convention kept
 * whatever casing their source export used. Everything reads them
 * case-insensitively, so this is cosmetic consistency rather than a fix — run
 * it when you want the stored data to match the templates.
 *
 * Dry run (prints what would change, writes nothing):
 *   npx ts-node scripts/uppercase-metadata-keys.ts
 * Apply:
 *   npx ts-node scripts/uppercase-metadata-keys.ts --apply
 *
 * Values are never touched — only keys. Rows whose keys are already canonical
 * are skipped, so re-running it is a no-op.
 */
import { pool } from '../src/config/db';
import { upperCaseKeys } from '../src/services/validation';

async function main() {
  const apply = process.argv.includes('--apply');
  const { rows } = await pool.query(
    `SELECT id, customer_code, name, source_metadata FROM stores
     WHERE source_metadata IS NOT NULL AND source_metadata::text <> '{}'`
  );
  console.log(`${rows.length} store(s) carry source_metadata\n`);

  let changed = 0;
  for (const r of rows) {
    const before = r.source_metadata as Record<string, unknown>;
    const after = upperCaseKeys(before);
    const beforeKeys = Object.keys(before);
    const afterKeys = Object.keys(after);
    // Key order is preserved by upperCaseKeys, so comparing the joined lists is
    // enough to tell whether anything actually needs rewriting.
    if (beforeKeys.join('|') === afterKeys.join('|')) continue;
    changed++;
    const renamed = beforeKeys
      .filter((k, i) => k !== afterKeys[i])
      .map((k, i) => `${k} -> ${afterKeys[beforeKeys.indexOf(k)] ?? afterKeys[i]}`);
    console.log(`  ${r.customer_code ?? r.id} (${r.name}): ${renamed.join(', ')}`);
    if (apply) {
      await pool.query(
        'UPDATE stores SET source_metadata = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(after), r.id]
      );
    }
  }

  console.log(
    changed === 0
      ? '\nNothing to do — every stored column name is already all-caps.'
      : apply
        ? `\n${changed} store(s) updated.`
        : `\n${changed} store(s) would change. Re-run with --apply to write.`
  );
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
