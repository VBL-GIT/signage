import { Response } from 'express';
import * as XLSX from 'xlsx';
import bcrypt from 'bcryptjs';
import { PoolClient } from 'pg';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '../types/domain';
import { resolveUserScope, duplicateEmailMessage } from '../services/users.service';
import {
  isEmailConfigured, sendCredentialsEmail, sendVendorWelcomeEmail, verifyEmailDeliverable,
} from '../services/email.service';
import { generateTemporaryPassword } from '../services/password';
import { env } from '../config/env';
import { emailDomain, joinAddressParts, validateEmail, validateOptionalEmail } from '../services/validation';
import {
  StoreInput,
  bulkUpsertStores,
  loadStoreIdentityLookup,
  normalizeStoreInput,
  resolveStoreIdentity,
} from '../services/stores.service';

interface RowError { row: number; reason: string }

// SSRF guard: the bulk endpoints fetch a user-supplied file_url server-side.
// Only allow URLs hosted on our own Supabase Storage origin so this can't be
// used to pull from internal/metadata endpoints (e.g. 169.254.169.254) or
// arbitrary intranet hosts.
const STORAGE_ORIGIN = (() => {
  try { return new URL(env.SUPABASE_URL).origin; } catch { return ''; }
})();

function assertAllowedFileUrl(fileUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(fileUrl); } catch { throw new Error('file_url is not a valid URL'); }
  if (parsed.protocol !== 'https:') throw new Error('file_url must use https');
  if (!STORAGE_ORIGIN || parsed.origin !== STORAGE_ORIGIN) {
    throw new Error('file_url must point to the configured storage bucket');
  }
}

async function fetchSheetRows(fileUrl: string): Promise<Record<string, unknown>[]> {
  assertAllowedFileUrl(fileUrl);
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Could not download file (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
}

function str(v: unknown): string {
  return (v === undefined || v === null) ? '' : String(v).trim();
}

const CHUNK = 500;

/**
 * Insert pre-validated rows in chunks via multi-row VALUES, inside the given client.
 * Returns the concatenated RETURNING rows. `conflict` lets callers add ON CONFLICT clauses.
 */
async function chunkedInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  valueRows: unknown[][],
  opts: { conflict?: string; returning?: string } = {}
): Promise<any[]> {
  const ncols = columns.length;
  const out: any[] = [];
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    const chunk = valueRows.slice(i, i + CHUNK);
    const placeholders = chunk
      .map((_, ri) => `(${columns.map((__, ci) => `$${ri * ncols + ci + 1}`).join(',')})`)
      .join(',');
    const params = chunk.flat();
    const sql =
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}` +
      (opts.conflict ? ` ${opts.conflict}` : '') +
      (opts.returning ? ` RETURNING ${opts.returning}` : '');
    const r = await client.query(sql, params);
    out.push(...r.rows);
  }
  return out;
}

/** Run the insert phase in a single transaction on one pooled client. */
async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------------
/**
 * Bulk onboard users from an Excel file.
 * Expected columns: first_name, last_name, email, role, mobile, vendor_uid (optional).
 * Passwords are NOT taken from the sheet — each account gets a generated one.
 */
const ROLE_LETTER: Partial<Record<UserRole, string>> = { employee: 'E', vendor_admin: 'A', vendor_user: 'U' };
const VENDOR_SCOPED: UserRole[] = ['vendor_admin', 'vendor_user', 'employee'];

/**
 * Roles a spreadsheet row may name. The manual endpoint gets this from its Zod
 * enum, but bulk rows never pass through Zod — only `file_url` does — so the
 * value has to be checked here.
 *
 * Without it an unrecognised role (a capitalised "Employee", say) survives
 * resolveUserScope, which only asks whether the role is vendor-scoped, and is
 * caught much later by the users_role_check constraint. That surfaces as a
 * blanket 500 with no row number instead of a per-row validation failure.
 */
const VALID_ROLES: UserRole[] = ['rjcorp_admin', 'rjcorp_user', 'vendor_admin', 'vendor_user', 'employee'];

export async function bulkUsers(req: AuthRequest, res: Response) {
  const { file_url } = req.body;
  let rows: Record<string, unknown>[];
  try { rows = await fetchSheetRows(file_url); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

  const vendorByUid = new Map<string, { id: string; code: number }>();
  const vendorById = new Map<string, number>();
  const { rows: vendors } = await pool.query('SELECT id, uid, code FROM vendors');
  for (const v of vendors) { vendorByUid.set(String(v.uid), { id: v.id, code: v.code }); vendorById.set(v.id, v.code); }

  const failed: RowError[] = [];
  interface Valid { row: number; name: string; first: string; last: string; email: string; password: string; role: UserRole; mobile: string | null; vendorId: string | null; }
  const valid: Valid[] = [];
  const seenEmails = new Set<string>();

  // Phase 1 — validate every row in JS (no DB writes), collect per-row errors.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    try {
      const rawRole = str(r.role);
      if (!VALID_ROLES.includes(rawRole as UserRole)) {
        throw new Error(
          rawRole
            ? `Invalid role "${rawRole}". Must be one of: ${VALID_ROLES.join(', ')}`
            : `role is required. Must be one of: ${VALID_ROLES.join(', ')}`
        );
      }
      const role = rawRole as UserRole;
      const vendorUid = str(r.vendor_uid);
      const bodyVendorId = vendorUid ? vendorByUid.get(vendorUid)?.id ?? null : null;
      if (vendorUid && !bodyVendorId) throw new Error(`Unknown vendor_uid "${vendorUid}"`);
      const scope = resolveUserScope(req.user!, role, bodyVendorId);

      const first = str(r.first_name), last = str(r.last_name);
      if (!first || !last) throw new Error('first_name and last_name are required');

      // Same syntax + typo rules as the manual Create Account form.
      const check = validateEmail(r.email, 'email');
      if (!check.ok) throw new Error(check.reason!);
      const email = check.value;
      if (seenEmails.has(email)) throw new Error('Duplicate email within the file');
      seenEmails.add(email);

      valid.push({
        row: rowNum, name: `${first} ${last}`.trim(), first, last, email,
        // A distinct cryptographically-random password per row. Any `password`
        // column in the sheet is ignored — the file must never be able to set
        // credentials, and the old `password123` fallback is gone.
        password: generateTemporaryPassword(),
        role: scope.role, mobile: str(r.mobile) || null, vendorId: scope.vendor_id,
      });
    } catch (e) {
      failed.push({ row: rowNum, reason: (e as Error).message || 'Unknown error' });
    }
  }

  // Pre-check existing emails. All-or-nothing: any failure (validation or a
  // pre-existing email) aborts the whole import — nothing is inserted, so a
  // failed upload never leaves a partial result the admin has to untangle.
  if (valid.length) {
    const { rows: ex } = await pool.query(
      'SELECT lower(email) AS e, vendor_id FROM users WHERE lower(email) = ANY($1)',
      [valid.map((v) => v.email)]
    );
    const existing = new Map<string, string | null>(ex.map((x) => [x.e, x.vendor_id]));
    for (const v of valid) {
      if (existing.has(v.email)) {
        // Same wording as the manual form: same-vendor vs. another account.
        failed.push({ row: v.row, reason: `${duplicateEmailMessage(existing.get(v.email)!, v.vendorId)} (${v.email})` });
      }
    }

    // Deliverability (DNS MX) — matches the manual endpoint. No-op unless
    // EMAIL_VERIFY_MX is on; resolved once per distinct domain, not per row,
    // so a large import doesn't fire thousands of identical DNS lookups.
    const domains = [...new Set(valid.map((v) => emailDomain(v.email)))];
    const verdicts = new Map<string, { ok: boolean; reason?: string }>();
    await Promise.all(domains.map(async (d) => verdicts.set(d, await verifyEmailDeliverable(`probe@${d}`))));
    for (const v of valid) {
      const verdict = verdicts.get(emailDomain(v.email));
      if (verdict && !verdict.ok) failed.push({ row: v.row, reason: verdict.reason || 'Invalid email domain' });
    }
  }

  if (failed.length) {
    failed.sort((a, b) => a.row - b.row);
    res.json({ inserted: 0, failed });
    return;
  }
  if (!valid.length) {
    res.json({ inserted: 0, failed });
    return;
  }

  // Per-(vendor,role) running UID counter seeded from current DB counts.
  const counters = new Map<string, number>();
  for (const v of valid) {
    if (!v.vendorId || !ROLE_LETTER[v.role]) continue;
    const k = `${v.vendorId}|${v.role}`;
    if (!counters.has(k)) {
      const { rows: c } = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE vendor_id = $1 AND role = $2', [v.vendorId, v.role]);
      counters.set(k, c[0].n);
    }
  }

  const hashes = await Promise.all(valid.map((v) => bcrypt.hash(v.password, 10)));
  const tuples = valid.map((v, idx) => {
    let uid: string | null = null;
    if (v.vendorId && ROLE_LETTER[v.role]) {
      const k = `${v.vendorId}|${v.role}`;
      const next = counters.get(k)! + 1; counters.set(k, next);
      uid = `V${vendorById.get(v.vendorId)}-${ROLE_LETTER[v.role]}${String(next).padStart(3, '0')}`;
    }
    return [v.name, v.first, v.last, v.email, hashes[idx], v.role, v.mobile, v.vendorId, uid];
  });

  const out = await inTransaction((client) => chunkedInsert(
    client, 'users',
    ['name', 'first_name', 'last_name', 'email', 'password_hash', 'role', 'phone', 'vendor_id', 'uid'],
    tuples, { returning: 'id, email, uid' }
  ));
  const inserted = out.length;
  // Map by email rather than trusting RETURNING to come back in VALUES order.
  const rowByEmail = new Map<string, { id: string; uid: string | null }>(
    out.map((r) => [String(r.email).toLowerCase(), { id: r.id, uid: r.uid }])
  );

  // Email each new account its own temporary password — same flow and template
  // as the manual Create Account form. Best-effort with capped concurrency;
  // no-op unless RESEND_API_KEY is configured. For very large imports a
  // background queue would be preferable.
  //
  // The response reports counts and the ADDRESSES whose delivery failed —
  // never a password. An address that fails here has an undeliverable
  // temporary password that is gone once this request ends, so the admin needs
  // to know exactly who must use Forgot Password. The addresses came from the
  // admin's own upload, so echoing them back reveals nothing new.
  let emailed = 0;
  const email_failed: string[] = [];
  if (isEmailConfigured() && valid.length) {
    const CONC = 5;
    for (let i = 0; i < valid.length; i += CONC) {
      const slice = valid.slice(i, i + CONC);
      const results = await Promise.all(slice.map(async (u) => {
        const created = rowByEmail.get(u.email);
        if (!created) return false;
        return sendCredentialsEmail({
          to: u.email, name: u.name, email: u.email,
          password: u.password, role: u.role, uid: created.uid,
        });
      }));
      results.forEach((ok, k) => {
        if (ok) emailed++;
        else email_failed.push(slice[k].email);
      });
    }
  } else if (valid.length) {
    // Email not configured at all: no password reached anyone.
    email_failed.push(...valid.map((u) => u.email));
  }
  res.json({ inserted, emailed, email_failed, failed });
}

// ----------------------------------------------------------------------------
/**
 * Bulk create tasks from an Excel file (RJCorp admin only).
 * Each task type has its own template, so `kind` (recee | direct | direct_boarding)
 * fixes the type for every row and the sheet omits the task_type/installation_type
 * columns. When `kind` is absent, the legacy combined format is read per-row.
 * Type-specific columns: vendor_uid, store_uid, pincode,
 *   target_pamphlet_count (direct), brand_name, artwork_name, width_in, height_in
 *   (direct_boarding). Board size is width_in / height_in (inches) → custom cm.
 * Store is identified by store_uid only — no store_name fallback, since names
 * can collide across vendors/stores while UIDs are unambiguous.
 */
const INCH_TO_CM = 2.54;
// kind → [task_type, installation_type]
const TASK_KIND: Record<string, [string, string | null]> = {
  recee: ['recee', null],
  direct: ['installation', 'direct'],
  direct_boarding: ['installation', 'direct_boarding'],
};

export async function bulkTasks(req: AuthRequest, res: Response) {
  const { file_url, kind } = req.body as { file_url: string; kind?: string };
  const fixedType = kind ? TASK_KIND[kind] : null;
  let rows: Record<string, unknown>[];
  try { rows = await fetchSheetRows(file_url); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

  const vendorByUid = new Map<string, string>();
  for (const v of (await pool.query('SELECT id, uid FROM vendors')).rows) vendorByUid.set(String(v.uid), v.id);
  // Stores are found by Customer Code, the identifier the templates now carry.
  // Legacy uids are loaded into the same map so spreadsheets saved from the
  // older store_uid templates keep resolving. Customer code is inserted second
  // so it wins if some store's uid happens to equal another's code.
  const storeByUid = new Map<string, string>();
  for (const s of (await pool.query(
    'SELECT id, uid, customer_code FROM stores WHERE uid IS NOT NULL OR customer_code IS NOT NULL'
  )).rows) {
    if (s.uid) storeByUid.set(String(s.uid).toLowerCase(), s.id);
  }
  for (const s of (await pool.query(
    'SELECT id, customer_code FROM stores WHERE customer_code IS NOT NULL'
  )).rows) {
    storeByUid.set(String(s.customer_code).toLowerCase(), s.id);
  }
  const brandByName = new Map<string, string>();
  for (const b of (await pool.query('SELECT id, name FROM brands')).rows) brandByName.set(String(b.name).toLowerCase(), b.id);
  // Artworks keyed by `${brand_id}|${lower(name)}` — must match the row's brand.
  const artworkByBrandName = new Map<string, string>();
  for (const a of (await pool.query('SELECT id, brand_id, name FROM artworks')).rows) {
    artworkByBrandName.set(`${a.brand_id}|${String(a.name).toLowerCase()}`, a.id);
  }

  const failed: RowError[] = [];
  const tuples: unknown[][] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    try {
      let taskType: string;
      let installationType: string | null;
      if (fixedType) {
        // Type-specific template: the kind fixes the type; sheet has no type columns.
        [taskType, installationType] = fixedType;
      } else {
        // Legacy combined template: read the type from the row.
        taskType = str(r.task_type);
        if (!['recee', 'installation'].includes(taskType)) throw new Error(`Invalid task_type "${taskType}"`);
        installationType = null;
        if (taskType === 'installation') {
          installationType = str(r.installation_type);
          if (installationType !== 'direct' && installationType !== 'direct_boarding') {
            throw new Error('installation_type must be "direct" or "direct_boarding"');
          }
        }
      }
      const isBoarding = installationType === 'direct_boarding';
      // The template column is customer_code; store_uid is still read so
      // spreadsheets saved from the previous templates keep working.
      const storeUid = str(r.customer_code) || str(r.store_uid);
      if ((taskType === 'recee' || isBoarding) && !storeUid) {
        throw new Error(`customer_code is required for ${taskType === 'recee' ? 'recee' : 'boarding installation'} tasks`);
      }

      const vendorUid = str(r.vendor_uid);
      const vendorId = vendorUid ? vendorByUid.get(vendorUid) : null;
      if (!vendorId) throw new Error(`Unknown vendor_uid "${vendorUid}"`);

      let storeId: string | null = null;
      if (storeUid) {
        storeId = storeByUid.get(storeUid.toLowerCase()) ?? null;
        if (!storeId) throw new Error(`Unknown Customer Code "${storeUid}"`);
      }

      let brandId: string | null = null, artworkId: string | null = null;
      let customW: number | null = null, customH: number | null = null;
      if (isBoarding) {
        const bn = str(r.brand_name);
        if (bn) { brandId = brandByName.get(bn.toLowerCase()) ?? null; if (!brandId) throw new Error(`Unknown brand_name "${bn}"`); }
        const an = str(r.artwork_name);
        if (an) {
          if (!brandId) throw new Error('brand_name is required when artwork_name is given');
          artworkId = artworkByBrandName.get(`${brandId}|${an.toLowerCase()}`) ?? null;
          if (!artworkId) throw new Error(`Unknown artwork_name "${an}" for the given brand`);
        }
        // Board size as width_in x height_in (inches) -> stored as custom cm.
        const wStr = str(r.width_in), hStr = str(r.height_in);
        if (wStr || hStr) {
          const w = parseFloat(wStr), h = parseFloat(hStr);
          if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
            throw new Error('width_in and height_in must both be positive numbers (inches)');
          }
          customW = Math.round(w * INCH_TO_CM);
          customH = Math.round(h * INCH_TO_CM);
        }
      }
      const tpcStr = installationType === 'direct' ? str(r.target_pamphlet_count) : '';
      const tpc = tpcStr ? parseInt(tpcStr, 10) : null;

      tuples.push([taskType, installationType, vendorId, storeId, brandId, artworkId, customW, customH, str(r.pincode) || null, tpc]);
    } catch (e) {
      failed.push({ row: rowNum, reason: (e as Error).message || 'Unknown error' });
    }
  }

  // All-or-nothing: if any row failed validation, import nothing.
  if (failed.length) {
    failed.sort((a, b) => a.row - b.row);
    res.json({ inserted: 0, failed });
    return;
  }

  let inserted = 0;
  if (tuples.length) {
    await inTransaction(async (client) => {
      const created = await chunkedInsert(
        client, 'tasks',
        ['task_type', 'installation_type', 'vendor_id', 'store_id', 'brand_id', 'artwork_id', 'custom_width_cm', 'custom_height_cm', 'pincode', 'target_pamphlet_count'],
        tuples, { returning: 'id, installation_type, brand_id, artwork_id, custom_width_cm, custom_height_cm' }
      );
      inserted = created.length;
      // Each direct_boarding task needs a one-signage plan so the employee sees a requirement.
      const planTuples = created
        .filter((t) => t.installation_type === 'direct_boarding')
        .map((t) => [t.id, 1, null, null, t.custom_width_cm, t.custom_height_cm, t.brand_id, t.artwork_id]);
      if (planTuples.length) {
        await chunkedInsert(
          client, 'task_signage_plan',
          ['task_id', 'signage_index', 'signage_type', 'boarding_size_id', 'custom_width_cm', 'custom_height_cm', 'brand_id', 'artwork_id'],
          planTuples
        );
      }
    });
  }
  res.json({ inserted, failed });
}

// ----------------------------------------------------------------------------
/**
 * Look a column up without caring how the header was cased or punctuated.
 *
 * The same export is written "CUST_CD", "Cust_CD" and "cust cd" depending on
 * who produced it, so keys are normalised to lowercase alphanumerics before
 * matching: "State_CD", "state cd" and "STATECD" all collapse to "statecd".
 * Several names can be given for genuinely different spellings — notably
 * LATITUDE, which some exports spell LATTITUDE — and the first one present
 * wins.
 */
function columnLookup(r: Record<string, unknown>) {
  const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byNormalised = new Map<string, unknown>();
  for (const [k, v] of Object.entries(r)) {
    const n = norm(k);
    // First occurrence wins, so an exact header is never shadowed by a later one.
    if (!byNormalised.has(n)) byNormalised.set(n, v);
  }
  return (...names: string[]): unknown => {
    for (const name of names) {
      const v = byNormalised.get(norm(name));
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  };
}

/**
 * Map one row of the customer-master ("speed dump") export onto the store
 * fields this application actually uses. Columns with no home here are not
 * discarded — the whole original row is preserved verbatim in
 * stores.source_metadata.
 *
 * That export has no email column at all, so contact_email is never set by
 * this channel (and the upsert preserves any address already on record).
 */
function fromCustomerMaster(r: Record<string, unknown>): Record<string, unknown> {
  const col = columnLookup(r);
  return {
    customer_code: str(col('CUST_CD')),
    // Customer Code is the store's identifier. uid is no longer collected but
    // is kept in step with it, because tasks and images still resolve stores by
    // uid. A CUST_UID column, where an export carries one, still wins.
    uid: str(col('CUST_UID')) || str(col('CUST_CD')),
    name: str(col('CUST_NAME')),
    address: joinAddressParts([col('ADDR_1'), col('ADDR_2'), col('ADDR_3'), col('ADDR_4'), col('ADDR_5')]),
    pincode: str(col('ADDR_POSTAL')),
    // LATTITUDE is a common misspelling in real exports; accept either.
    lat: str(col('LATITUDE', 'LATTITUDE')),
    long: str(col('LONGITUDE', 'LONGTITUDE')),
    contact_person: str(col('CONT_PR')),
    contact_no: str(col('MOBILE_NO')),
    // CUST_STATUS is the outlet status. Everything else on the row — HOS,
    // State_CD, CHANNEL, SUB_CHANNEL and any extra columns a wider export
    // carries — has no field of its own but is kept in source_metadata.
    outlet_status: str(col('CUST_STATUS')),
    source_metadata: r,
  };
}

/**
 * Bulk create-or-update stores from an Excel file.
 *
 * There is one store template — the customer-master ("speed dump") layout —
 * but two sheet shapes still import, and the format is DETECTED from the
 * headers rather than declared by the caller:
 *   customer master  — CUST_CD / Cust_CD / cust cd present
 *   compact          — the older customer_code / name / address sheet
 * An explicit `format` in the body still overrides the detection, so an older
 * client that names the format keeps working.
 *
 * Detecting rather than trusting the caller means a sheet uploaded on the wrong
 * tab imports correctly instead of failing every row on missing columns.
 *
 * Customer Code is the upsert key: a row whose code already exists UPDATES that
 * store in place (its stores.id is preserved, so existing tasks and assignments
 * keep pointing at it); a new code INSERTS. vendor_uid is not part of the store
 * template — a store's vendor mapping is left exactly as it is.
 *
 * All-or-nothing: if any row fails validation, nothing is written at all.
 */
export async function bulkStores(req: AuthRequest, res: Response) {
  const { file_url, format } = req.body as { file_url: string; format?: string };
  let rows: Record<string, unknown>[];
  try { rows = await fetchSheetRows(file_url); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

  // Header-based detection, on the first row's keys. Any casing or punctuation
  // of CUST_CD counts, since that column exists only in the customer master.
  const looksLikeMaster = rows.length > 0 &&
    Object.keys(rows[0]).some((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === 'custcd');
  const isMaster = format === 'customer_master' || (format !== 'compact' && looksLikeMaster);

  const failed: RowError[] = [];
  interface Valid { row: number; input: StoreInput }
  const valid: Valid[] = [];

  // Track in-file duplicates by both unique keys. Every occurrence is reported
  // (not just the second), so the operator can see each row that needs fixing.
  const codeRows = new Map<string, number[]>();
  const uidRows = new Map<string, number[]>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // 1-based, plus the header row
    const raw = isMaster ? fromCustomerMaster(rows[i]) : rows[i];
    const { input, errors } = normalizeStoreInput(raw, { requireContactEmail: !isMaster });

    if (errors.length) {
      failed.push({ row: rowNum, reason: errors.join('; ') });
      continue;
    }
    const codeKey = input.customer_code.toLowerCase();
    const uidKey = input.uid.toLowerCase();
    if (!codeRows.has(codeKey)) codeRows.set(codeKey, []);
    codeRows.get(codeKey)!.push(rowNum);
    if (!uidRows.has(uidKey)) uidRows.set(uidKey, []);
    uidRows.get(uidKey)!.push(rowNum);

    valid.push({ row: rowNum, input });
  }

  const dupeRows = new Set<number>();
  for (const [code, rs] of codeRows) {
    if (rs.length > 1) {
      for (const r of rs) {
        dupeRows.add(r);
        failed.push({ row: r, reason: `Duplicate customer_code "${code}" in this file (also on row ${rs.filter((x) => x !== r).join(', ')})` });
      }
    }
  }
  for (const [uid, rs] of uidRows) {
    if (rs.length > 1) {
      for (const r of rs) {
        if (dupeRows.has(r)) continue; // already reported for a duplicate code
        failed.push({ row: r, reason: `Duplicate uid "${uid}" in this file (also on row ${rs.filter((x) => x !== r).join(', ')})` });
      }
    }
  }

  // Resolve each row against existing stores using the same identity rule the
  // manual endpoints use — code and uid must not name two different stores.
  if (valid.length && !failed.length) {
    const lookup = await loadStoreIdentityLookup();
    for (const v of valid) {
      const identity = resolveStoreIdentity(lookup, v.input.customer_code, v.input.uid);
      if (!identity.ok) failed.push({ row: v.row, reason: identity.reason });
    }
  }

  if (failed.length) {
    failed.sort((a, b) => a.row - b.row);
    res.json({ inserted: 0, updated: 0, failed });
    return;
  }
  if (!valid.length) {
    res.json({ inserted: 0, updated: 0, failed });
    return;
  }

  const { created, updated } = await inTransaction((client) =>
    bulkUpsertStores(client, valid.map((v) => v.input))
  );
  res.json({ inserted: created, updated, failed });
}

// ----------------------------------------------------------------------------
/**
 * Bulk create vendors from an Excel file (RJCorp admin only).
 * Columns: name (required), contact_person, contact_phone, contact_email. UID auto-generated (VND-NNN).
 */
export async function bulkVendors(req: AuthRequest, res: Response) {
  const { file_url } = req.body;
  let rows: Record<string, unknown>[];
  try { rows = await fetchSheetRows(file_url); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

  const failed: RowError[] = [];
  interface V { row: number; name: string; email: string | null; tuple: unknown[] }
  const valid: V[] = [];
  const seenEmails = new Set<string>();
  const seenNames = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    try {
      // The template header is `company_name`; `name` is still accepted so
      // sheets saved from the previous template keep working.
      const name = str(r.company_name) || str(r.name);
      if (!name) throw new Error('company_name is required');
      // Vendor names must be unique case-insensitively, exactly as the manual
      // Create Vendor form requires. Two vendors with the same name are
      // indistinguishable in the console and ambiguous to a human resolving
      // "which vendor is this task for".
      if (seenNames.has(name.toLowerCase())) {
        throw new Error(`Duplicate vendor name within the file: ${name}`);
      }
      seenNames.add(name.toLowerCase());
      // Vendor email stays optional, but when present it must be valid — the
      // same rule the manual Create Vendor form applies.
      const check = validateOptionalEmail(r.contact_email, 'contact_email');
      if (!check.ok) throw new Error(check.reason!);
      const email = check.value;
      if (email) {
        if (seenEmails.has(email)) throw new Error(`Duplicate email within the file: ${email}`);
        seenEmails.add(email);
      }
      valid.push({
        row: rowNum, name, email,
        tuple: [name, str(r.contact_person) || null, str(r.contact_phone) || null, email,
                str(r.remarks).slice(0, 2000) || null],
      });
    } catch (e) {
      failed.push({ row: rowNum, reason: (e as Error).message || 'Unknown error' });
    }
  }

  // Existing-name check (case-insensitive), batched like the email check below.
  // Without this, bulk import could create a duplicate that the manual endpoint
  // rejects — the two paths must enforce the same rule.
  if (valid.length) {
    const { rows: exName } = await pool.query(
      'SELECT lower(name) AS n, uid FROM vendors WHERE lower(name) = ANY($1)',
      [valid.map((v) => v.name.toLowerCase())]
    );
    const existingNames = new Map<string, string>(exName.map((x) => [x.n, x.uid]));
    for (const v of valid) {
      const uid = existingNames.get(v.name.toLowerCase());
      if (uid) failed.push({ row: v.row, reason: `A vendor named "${v.name}" already exists (${uid})` });
    }
  }

  // Existing-email check (case-insensitive). All-or-nothing: any failure aborts the whole import.
  const withEmail = valid.filter((v) => v.email);
  if (withEmail.length) {
    const { rows: ex } = await pool.query(
      'SELECT lower(contact_email) AS e FROM vendors WHERE contact_email IS NOT NULL AND lower(contact_email) = ANY($1)',
      [withEmail.map((v) => v.email!.toLowerCase())]
    );
    const existing = new Set(ex.map((x) => x.e));
    for (const v of withEmail) {
      if (existing.has(v.email!.toLowerCase())) failed.push({ row: v.row, reason: `Vendor email already exists: ${v.email}` });
    }
  }

  if (failed.length) {
    failed.sort((a, b) => a.row - b.row);
    res.json({ inserted: 0, failed });
    return;
  }

  let inserted = 0;
  let registered: { name: string; uid: string; email: string | null; person: string | null }[] = [];
  if (valid.length) {
    await inTransaction(async (client) => {
      const created = await chunkedInsert(
        client, 'vendors',
        ['name', 'contact_person', 'contact_phone', 'contact_email', 'remarks'],
        valid.map((v) => v.tuple), { returning: 'id, code, name, contact_email, contact_person' }
      );
      inserted = created.length;
      // Assign VND-NNN UIDs from the auto-generated codes in one batched UPDATE.
      if (created.length) {
        await client.query(
          `UPDATE vendors v SET uid = data.uid
           FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS uid) data
           WHERE v.id = data.id`,
          [created.map((c) => c.id), created.map((c) => `VND-${String(c.code).padStart(3, '0')}`)]
        );
      }
      registered = created.map((c) => ({
        name: c.name,
        uid: `VND-${String(c.code).padStart(3, '0')}`,
        email: c.contact_email,
        person: c.contact_person,
      }));
    });
  }

  // Registration confirmations, after the transaction commits so no email ever
  // announces a vendor that was rolled back. Same no-credentials content as the
  // manual Create Vendor flow.
  let emailed = 0;
  if (isEmailConfigured() && registered.length) {
    const CONC = 5;
    const withEmail = registered.filter((v) => v.email);
    for (let i = 0; i < withEmail.length; i += CONC) {
      const results = await Promise.all(withEmail.slice(i, i + CONC).map((v) =>
        sendVendorWelcomeEmail({ to: v.email!, vendorName: v.name, vendorUid: v.uid, contactPerson: v.person })
      ));
      emailed += results.filter(Boolean).length;
    }
  }
  res.json({ inserted, emailed, failed });
}
