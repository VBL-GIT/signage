import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

// Known dev/demo secret values that must never reach production.
const WEAK_SECRETS = new Set(['dev', 'devsecret', 'secret', 'changeme', 'jwt_secret', 'jwt_refresh_secret']);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.string().default('3000'),
    DATABASE_URL: z.string(),
    JWT_SECRET: z.string(),
    JWT_REFRESH_SECRET: z.string(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_KEY: z.string(),
    SUPABASE_STORAGE_BUCKET: z.string().default('signage-photos'),
    // Comma-separated list of allowed browser origins for CORS (web console).
    // Empty in development = allow all (convenient for LAN/device testing).
    ALLOWED_ORIGINS: z.string().default(''),
    // Max pooled Postgres connections. Raise for production traffic.
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),

    // --- Outbound email (credential delivery, password reset), via Resend's
    // HTTPS API. All optional: if RESEND_API_KEY is not set, account creation
    // and password reset still work but no email is sent. Raw SMTP (e.g. to
    // Gmail) is deliberately not used here — cloud hosts like Render get
    // silently throttled/blocked on outbound SMTP to Gmail's relay, which an
    // HTTPS API sidesteps entirely.
    RESEND_API_KEY: z.string().optional(),
    // From address shown to recipients. Must be on a domain verified with
    // Resend; defaults to their no-verification-needed sandbox sender.
    RESEND_FROM: z.string().default('VBL Signage <onboarding@resend.dev>'),
    // Verify the recipient domain can receive mail (DNS MX lookup) before creating.
    EMAIL_VERIFY_MX: z.coerce.boolean().default(false),
    // Login URL included in the credential email. Defaults to first allowed origin.
    APP_WEB_URL: z.string().optional(),
  })
  // In production, refuse to boot on weak/short JWT secrets — this is what
  // protects every issued token, so a leaked dev value is a full compromise.
  .superRefine((val, ctx) => {
    if (val.NODE_ENV !== 'production') return;
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const v = val[key];
      if (v.length < 32 || WEAK_SECRETS.has(v.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'must be a strong random string of at least 32 characters in production',
        });
      }
    }
    if (val.JWT_SECRET === val.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_SECRET' });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';

/** Parsed list of allowed CORS origins (empty = allow all, dev only). */
export const allowedOrigins = env.ALLOWED_ORIGINS
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
