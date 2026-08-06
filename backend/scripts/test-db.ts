import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgresql://postgres.vywiaitfytwdbiznbjsh:ArthVBL2026@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
});

pool.query('SELECT 1')
  .then(() => console.log('DB OK'))
  .catch((e) => console.error('DB ERROR:', e.message))
  .finally(() => pool.end());
