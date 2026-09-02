/**
 * Shared field validation used by BOTH manual creation (controllers) and bulk
 * Excel import (bulk.controller). Having one module is the point: before this,
 * manual create ran Zod's .email() while bulk import ran no email check at all,
 * so the same spreadsheet row behaved differently depending on how it arrived.
 *
 * Syntax validation only — deliberately separate from the two other layers:
 *   1. syntax        -> here (synchronous, always on)
 *   2. domain exists -> verifyEmailDeliverable() in email.service (DNS MX,
 *                       opt-in via EMAIL_VERIFY_MX)
 *   3. typo hints    -> here, as an exact-match lookup of known-bad domains
 */

/** Trim + collapse internal whitespace runs; '' when there's nothing left. */
export function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}

/**
 * Deliberately stricter than Zod's .email().
 *
 * Rejects, in order of how often they actually show up in uploaded sheets:
 *   "john doe@gmail.com"  — whitespace anywhere
 *   "john@ gmail.com"     — whitespace anywhere
 *   "john@gmail"          — no dotted TLD
 *   "john@@gmail.com"     — more than one @
 *   "john@gmail..com"     — consecutive dots
 *   ".john@gmail.com"     — leading/trailing dot in the local part
 *   "john@-gmail.com"     — label starting/ending with a hyphen
 *   "john@gmail.c"        — single-character TLD
 *
 * Each dot-separated label must be non-empty, which is what kills the
 * consecutive-dot cases without a separate check.
 */
const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

// RFC 5321 practical limits — a value longer than this is malformed, not merely long.
const MAX_EMAIL_LEN = 254;
const MAX_LOCAL_LEN = 64;

/**
 * Common misspellings of high-volume consumer mail domains.
 *
 * Exact-match only, never fuzzy/edit-distance: every key below is a domain that
 * is never legitimate, so a hit is a certainty rather than a guess. That's what
 * makes it safe to hard-reject with a suggestion instead of merely warning —
 * there are no false positives to work around. Extend by adding keys; do not
 * swap this for a distance metric, which would start rejecting real domains.
 */
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmailc.om': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmall.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'yahou.com': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'outllok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'rediffmial.com': 'rediffmail.com',
  'rediffmai.com': 'rediffmail.com',
  'redifmail.com': 'rediffmail.com',
};

export interface EmailCheck {
  /** Normalised (trimmed + lower-cased) address. Only meaningful when ok. */
  value: string;
  ok: boolean;
  /** User-facing message when !ok. Safe to show directly in the UI / row error. */
  reason?: string;
}

/**
 * Validate and normalise an email address.
 *
 * Normalisation (trim + lower-case) happens BEFORE validation, so an address
 * that is only "invalid" because someone left a trailing space in Excel is
 * accepted and cleaned rather than rejected — which is the stated requirement
 * ("also trim accidental leading/trailing whitespace"). Whitespace *inside*
 * the address is still a hard error.
 */
export function validateEmail(raw: unknown, label = 'email'): EmailCheck {
  const value = str(raw).toLowerCase();

  if (!value) return { value, ok: false, reason: `${label} is required` };
  if (value.length > MAX_EMAIL_LEN) {
    return { value, ok: false, reason: `${label} is too long (max ${MAX_EMAIL_LEN} characters)` };
  }
  if (/\s/.test(value)) {
    return { value, ok: false, reason: `${label} "${value}" contains a space` };
  }
  const at = value.split('@').length - 1;
  if (at === 0) return { value, ok: false, reason: `${label} "${value}" is missing an "@"` };
  if (at > 1) return { value, ok: false, reason: `${label} "${value}" contains more than one "@"` };

  const [local, domain] = value.split('@');
  if (local.length > MAX_LOCAL_LEN) {
    return { value, ok: false, reason: `${label} "${value}" has too long a name before the "@"` };
  }
  if (!EMAIL_RE.test(value)) {
    if (!domain.includes('.')) {
      return { value, ok: false, reason: `${label} "${value}" is missing a domain ending such as ".com"` };
    }
    if (domain.includes('..') || local.includes('..')) {
      return { value, ok: false, reason: `${label} "${value}" contains two dots in a row` };
    }
    return { value, ok: false, reason: `${label} "${value}" is not a valid email address` };
  }

  const fix = DOMAIN_TYPOS[domain];
  if (fix) {
    return { value, ok: false, reason: `${label} "${value}" looks like a typo. Did you mean ${local}@${fix}?` };
  }

  return { value, ok: true };
}

/**
 * Same check for a field that may legitimately be blank. Returns null for an
 * empty input (store it as SQL NULL); otherwise validates as normal.
 */
export function validateOptionalEmail(
  raw: unknown,
  label = 'email'
): { value: string | null; ok: boolean; reason?: string } {
  if (!str(raw)) return { value: null, ok: true };
  const r = validateEmail(raw, label);
  return { value: r.ok ? r.value : null, ok: r.ok, reason: r.reason };
}

/** Domain part of an already-validated address (for MX lookups / caching). */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/**
 * Join the customer-master's ADDR_1..ADDR_5 into the single `address` column.
 *
 * The real dump needs all three cleanups: ADDR_5 is the literal placeholder
 * "-" on every row, ADDR_1/ADDR_2 are frequently near-identical, and internal
 * whitespace is ragged. Without them the stored address reads
 * "52B3  VRINDAVAN  THANE VRINDAVAN, 52B3 VRINDAVAN VRINDAVAN, Thane, ..., -".
 */
export function joinAddressParts(parts: unknown[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const cleaned = str(p).replace(/\s+/g, ' ');
    // Drop blanks and pure-punctuation placeholders ("-", "--", ".", "NA").
    if (!cleaned || /^[-.\s]*$/.test(cleaned) || /^n\.?a\.?$/i.test(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out.join(', ');
}
