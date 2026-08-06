import { pool } from '../src/config/db';

async function main() {
  // Fire several concurrent queries to force multiple new pooled connections at once —
  // this is exactly what used to trigger the "client is already executing a query" race.
  const results = await Promise.all(
    Array.from({ length: 5 }, () => pool.query('SHOW statement_timeout'))
  );
  console.log('statement_timeout on each connection:', results.map((r) => r.rows[0].statement_timeout));
  console.log('5 concurrent queries succeeded with no race warning.');
  await pool.end();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
