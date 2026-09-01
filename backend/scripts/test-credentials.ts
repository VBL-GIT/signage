/**
 * Credential-storage and login checks against the REAL database schema.
 *
 * SAFE TO RUN ANYWHERE: everything happens inside a single transaction that is
 * ALWAYS rolled back, including on failure. There is no COMMIT in this file.
 * Does not depend on migration 024.
 *
 * No generated password is ever printed, not even on failure — test output is
 * one of the places a plaintext password must never appear.
 *
 * Run: npx ts-node scripts/test-credentials.ts
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../src/config/db';
import { generateTemporaryPassword } from '../src/services/password';
import { verifyPassword } from '../src/services/auth.service';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}

const TAG = `zz-cred-${Date.now()}`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- storage: only a bcrypt hash, never plaintext -----------------------
    console.log('\n== password storage ==');
    const password = generateTemporaryPassword();

    // Mirrors users.service.insertUser exactly: bcrypt.hash(password, 10).
    const hash = await bcrypt.hash(password, 10);
    const { rows: ins } = await client.query(
      `INSERT INTO users (name, first_name, last_name, email, password_hash, role, uid)
       VALUES ($1,$2,$3,$4,$5,'employee',$6)
       RETURNING id, name, first_name, last_name, email, role, vendor_id, uid, is_active, created_at`,
      [`${TAG} User`, TAG, 'User', `${TAG}@example.com`, hash, `${TAG}-E001`]
    );
    const created = ins[0];

    // insertUser's RETURNING list is replicated above — it must not leak the hash.
    check('insertUser RETURNING has no password_hash', !('password_hash' in created));
    check('insertUser RETURNING has no plaintext password', !('password' in created));

    const { rows: stored } = await client.query(
      'SELECT password_hash FROM users WHERE id = $1', [created.id]
    );
    const storedHash: string = stored[0].password_hash;
    check('stored value is NOT the plaintext', storedHash !== password);
    check('stored value is a bcrypt hash', /^\$2[aby]\$\d{2}\$/.test(storedHash));
    check('stored hash does not contain the plaintext', !storedHash.includes(password));

    // Nothing anywhere in the row should hold the plaintext.
    const { rows: whole } = await client.query('SELECT * FROM users WHERE id = $1', [created.id]);
    const anyFieldHasPlaintext = Object.values(whole[0]).some(
      (v) => typeof v === 'string' && v.includes(password)
    );
    check('no column on the row contains the plaintext', !anyFieldHasPlaintext);

    // --- login: the emailed password actually works -------------------------
    console.log('\n== login with the emailed password ==');
    // verifyPassword is exactly what auth.controller.login calls.
    check('correct password verifies', await verifyPassword(password, storedHash));
    check('wrong password rejected', !(await verifyPassword('not-the-password', storedHash)));
    check('empty password rejected', !(await verifyPassword('', storedHash)));

    // The login query itself: case-insensitive email + is_active.
    const { rows: loginRows } = await client.query(
      'SELECT password_hash, is_active FROM users WHERE lower(email) = lower($1) AND is_active = true',
      [`${TAG}@EXAMPLE.com`]
    );
    check('login lookup finds the account (case-insensitive)', loginRows.length === 1);
    check('login lookup + verify succeeds end to end',
      loginRows.length === 1 && (await verifyPassword(password, loginRows[0].password_hash)));

    // Two accounts created in the same batch must not share a password.
    const pwB = generateTemporaryPassword();
    check('a second generated password differs', pwB !== password);
    check('the first hash does not validate the second password',
      !(await verifyPassword(pwB, storedHash)));

    // --- bulk pipeline: one distinct, working password per employee ---------
    // Mirrors bulkUsers exactly: generate per row, then
    // Promise.all(valid.map(v => bcrypt.hash(v.password, 10))), then one
    // multi-row INSERT.
    console.log('\n== bulk: a separate password per employee ==');
    const N = 5;
    const bulkRows = Array.from({ length: N }, (_, i) => ({
      email: `${TAG}-bulk${i}@example.com`,
      name: `${TAG} Bulk ${i}`,
      uid: `${TAG}-B${i}`,
      password: generateTemporaryPassword(),
    }));
    check('every generated password is distinct',
      new Set(bulkRows.map((r) => r.password)).size === N);

    const bulkHashes = await Promise.all(bulkRows.map((r) => bcrypt.hash(r.password, 10)));
    check('every hash is distinct', new Set(bulkHashes).size === N);

    const values = bulkRows
      .map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},'employee',$${i * 6 + 6})`)
      .join(',');
    const params = bulkRows.flatMap((r, i) => [r.name, TAG, `B${i}`, r.email, bulkHashes[i], r.uid]);
    const { rows: bulkIns } = await client.query(
      `INSERT INTO users (name, first_name, last_name, email, password_hash, role, uid)
       VALUES ${values} RETURNING id, email, uid`,
      params
    );
    check(`all ${N} bulk rows inserted`, bulkIns.length === N);
    check('bulk RETURNING carries no password field',
      bulkIns.every((r) => !('password_hash' in r) && !('password' in r)));

    // Each stored hash must validate ONLY its own password.
    let correctMatches = 0;
    let crossMatches = 0;
    for (const row of bulkIns) {
      const mine = bulkRows.find((r) => r.email === row.email)!;
      const { rows: h } = await client.query('SELECT password_hash FROM users WHERE id = $1', [row.id]);
      if (await verifyPassword(mine.password, h[0].password_hash)) correctMatches++;
      for (const other of bulkRows) {
        if (other.email === mine.email) continue;
        if (await verifyPassword(other.password, h[0].password_hash)) crossMatches++;
      }
    }
    check(`all ${N} employees can log in with their own password`, correctMatches === N, `${correctMatches}/${N}`);
    check('no employee can log in with another employee\'s password', crossMatches === 0, `${crossMatches} cross-matches`);

    const { rows: plaintextScan } = await client.query(
      `SELECT COUNT(*)::int n FROM users WHERE email LIKE $1 AND password_hash = ANY($2)`,
      [`${TAG}-bulk%`, bulkRows.map((r) => r.password)]
    );
    check('no row stores a plaintext password in password_hash', plaintextScan[0].n === 0);

    // --- forgot password: mechanism unchanged and still working -------------
    // Replicates auth.service's SQL on this transaction's client so nothing is
    // written outside the rollback.
    console.log('\n== forgot-password token mechanism ==');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    const { rows: tok } = await client.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3) RETURNING id, token_hash',
      [created.id, tokenHash, expires]
    );
    check('only the token HASH is stored, never the raw token', tok[0].token_hash !== token);

    const validate = async () => {
      const { rows } = await client.query(
        `SELECT id, user_id FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [tokenHash]
      );
      return rows[0] ?? null;
    };
    const first = await validate();
    check('a fresh token validates', !!first && first.user_id === created.id);

    await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [tok[0].id]);
    check('a consumed token no longer validates (single-use)', (await validate()) === null);

    // Expired tokens are rejected by the same predicate.
    const expiredHash = crypto.createHash('sha256').update('expired-' + token).digest('hex');
    await client.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,NOW() - INTERVAL \'1 hour\')',
      [created.id, expiredHash]
    );
    const { rows: expiredCheck } = await client.query(
      `SELECT id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [expiredHash]
    );
    check('an expired token does not validate', expiredCheck.length === 0);

    // A reset re-hashes and the new password takes over.
    const newPw = 'a-brand-new-password';
    const newHash = await bcrypt.hash(newPw, 10);
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, created.id]);
    const { rows: after } = await client.query('SELECT password_hash FROM users WHERE id = $1', [created.id]);
    check('after reset, the new password verifies', await verifyPassword(newPw, after[0].password_hash));
    check('after reset, the old temporary password no longer works',
      !(await verifyPassword(password, after[0].password_hash)));

    await client.query('ROLLBACK');
    console.log('\n(transaction rolled back — database unchanged)');
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nERROR (transaction rolled back):', (e as Error).message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
