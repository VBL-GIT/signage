import { Pool, PoolClient } from 'pg';
import { str } from './validation';

type Queryable = Pool | PoolClient;

/** Distance (metres) within which another outlet is flagged as a possible duplicate. */
export const DUPLICATE_RADIUS_M = Number(process.env.DUPLICATE_RADIUS_M) > 0 ? Number(process.env.DUPLICATE_RADIUS_M) : 150;

export type OutletType = 'speed' | 'non_speed';

/**
 * SPEED vs Non-SPEED classification of a newly discovered outlet.
 *
 * A SPEED outlet must carry its Customer Code — the same code the store templates
 * use, so the outlet lines up with the master. A Non-SPEED outlet must not be
 * rejected for lacking one (it gets a placeholder FLD- code, and any value sent
 * with it is ignored so the stored data can never contradict the classification).
 * The code is checked for plausible format only: there is no master to validate
 * it against, and none is invented.
 */
export function validateOutletClassification(
  outletType: unknown,
  customerCode: unknown
): { ok: true; is_speed: boolean; customer_code: string | null } | { ok: false; error: string } {
  if (outletType !== 'speed' && outletType !== 'non_speed') {
    return { ok: false, error: 'Choose whether this is a SPEED or a Non-SPEED outlet' };
  }
  if (outletType === 'non_speed') return { ok: true, is_speed: false, customer_code: null };

  const code = str(customerCode);
  if (!code) return { ok: false, error: 'Customer Code is required for a SPEED outlet' };
  if (!/^[A-Za-z0-9][A-Za-z0-9_\-/.]{1,49}$/.test(code)) {
    return { ok: false, error: 'Customer Code must be 2–50 characters: letters, numbers, - _ / .' };
  }
  return { ok: true, is_speed: true, customer_code: code };
}

export interface DuplicateCandidate { store_id: string; name: string; reasons: string[] }

export interface DuplicateProbe {
  name: string;
  pincode: string;
  lat: number;
  long: number;
  customer_code?: string | null;
}

/**
 * Pure rule for why a stored outlet might be the same place as a new one.
 * Proximity alone only ever FLAGS; it never merges or blocks.
 */
export function duplicateReasons(
  probe: DuplicateProbe,
  other: { name: string; pincode: string; customer_code: string | null; distance_m: number | null },
  radiusM = DUPLICATE_RADIUS_M
): string[] {
  const reasons: string[] = [];
  if (probe.customer_code && other.customer_code && probe.customer_code.toLowerCase() === other.customer_code.toLowerCase()) {
    reasons.push('same Customer Code');
  }
  if (other.name.trim().toLowerCase() === probe.name.trim().toLowerCase() && other.pincode === probe.pincode) {
    reasons.push('same name and pincode');
  }
  if (other.distance_m != null && other.distance_m <= radiusM) {
    reasons.push(`within ${Math.max(1, Math.round(other.distance_m))} m`);
  }
  return reasons;
}

/** Stores that may be the same outlet as `probe`, within the caller's vendor scope. */
export async function findDuplicateCandidates(
  q: Queryable, probe: DuplicateProbe, vendorId: string | null
): Promise<DuplicateCandidate[]> {
  const { rows } = await q.query(
    `SELECT id, name, pincode, customer_code, distance_m FROM (
       SELECT s.id, s.name, s.pincode, s.customer_code,
         6371000 * 2 * asin(sqrt(
           power(sin(radians(s.lat::float8 - $1::float8) / 2), 2) +
           cos(radians($1::float8)) * cos(radians(s.lat::float8)) *
           power(sin(radians(s.long::float8 - $2::float8) / 2), 2)
         )) AS distance_m
       FROM stores s
       WHERE (s.vendor_id IS NULL OR $3::uuid IS NULL OR s.vendor_id = $3)
     ) x
     WHERE distance_m <= $4
        OR (lower(name) = lower($5) AND pincode = $6)
        OR ($7::text IS NOT NULL AND lower(customer_code) = lower($7))
     LIMIT 20`,
    [probe.lat, probe.long, vendorId, DUPLICATE_RADIUS_M, probe.name, probe.pincode, probe.customer_code ?? null]
  );
  const out: DuplicateCandidate[] = [];
  for (const r of rows) {
    const reasons = duplicateReasons(probe, {
      name: r.name, pincode: r.pincode, customer_code: r.customer_code,
      distance_m: r.distance_m == null ? null : Number(r.distance_m),
    });
    if (reasons.length) out.push({ store_id: r.id, name: r.name, reasons });
  }
  return out;
}
