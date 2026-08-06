import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: env.DB_POOL_MAX,
  // Applied by pg per connection at startup — avoids racing an un-awaited
  // `SET statement_timeout` against the first real query on a new client.
  statement_timeout: 60000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB error', err);
});
