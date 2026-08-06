import { pool } from '../src/config/db';

/**
 * Loads production reference data only — brands and standard boarding sizes.
 * Idempotent (ON CONFLICT DO NOTHING). Contains NO demo users or stores.
 * VBL's real brand catalogue / sizes can replace these later.
 *
 * Usage: npm run seed:reference
 */
async function main() {
  await pool.query(`
    INSERT INTO brands (name) VALUES ('BrandX'), ('BrandY'), ('BrandZ')
    ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO standard_boarding_sizes (label, width_cm, height_cm) VALUES
      ('Small (2x1.5 ft)', 61, 46),
      ('Medium (4x3 ft)', 122, 91),
      ('Large (6x4 ft)', 183, 122),
      ('XL (8x4 ft)', 244, 122)
    ON CONFLICT DO NOTHING
  `);
  console.log('Reference data seeded (brands, standard boarding sizes).');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
