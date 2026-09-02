import crypto from 'crypto';

/**
 * Temporary password generation for newly-created accounts.
 *
 * The plaintext produced here exists only long enough to be bcrypt-hashed for
 * storage and placed in one outbound email. It is never persisted, never
 * logged, and never returned in an API response.
 */

// Ambiguous glyphs are excluded on purpose: a temporary password gets read off
// a screen and typed by hand, often on a phone, where O/0, l/1/I and similar
// are a genuine support burden.
const LOWER = 'abcdefghijkmnopqrstuvwxyz'; // no l
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';  // no I, O
const DIGIT = '23456789';                  // no 0, 1
const SYMBOL = '!@#$%*?-_';
const ALL = LOWER + UPPER + DIGIT + SYMBOL;

const DEFAULT_LENGTH = 16;

/**
 * One uniformly-random character.
 *
 * crypto.randomInt does rejection sampling internally, so every character is
 * equally likely. `randomBytes(1)[0] % chars.length` would NOT be uniform —
 * it biases toward the start of the alphabet whenever 256 isn't a multiple of
 * the alphabet size. Math.random is unsuitable here regardless: it is not a
 * CSPRNG and its output is predictable from observed values.
 */
function pick(chars: string): string {
  return chars[crypto.randomInt(chars.length)];
}

/**
 * A cryptographically-secure temporary password.
 *
 * Guarantees at least one lowercase, uppercase, digit and symbol so the result
 * satisfies common password policies, then shuffles so those four aren't
 * always in the same positions.
 *
 * At 16 characters over a ~70-character alphabet this is roughly 98 bits of
 * entropy — far beyond anything worth guessing.
 */
export function generateTemporaryPassword(length: number = DEFAULT_LENGTH): string {
  const required = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  const size = Math.max(length, required.length);
  const chars = [
    ...required,
    ...Array.from({ length: size - required.length }, () => pick(ALL)),
  ];

  // Fisher-Yates, CSPRNG-driven.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
