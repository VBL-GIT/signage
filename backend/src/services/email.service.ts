import { Resend } from 'resend';
import { promises as dns } from 'dns';
import { env, allowedOrigins } from '../config/env';

// Email goes out via Resend's HTTPS API rather than raw SMTP. Cloud hosts
// (Render included) get silently throttled/blocked on outbound SMTP
// connections to Gmail's relay — an HTTPS API sidesteps that class of problem
// entirely. Optional capability: if RESEND_API_KEY isn't set, the whole
// service no-ops gracefully so account creation keeps working in dev/demo.
let client: Resend | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

function getClient(): Resend | null {
  if (!isEmailConfigured()) return null;
  if (!client) client = new Resend(env.RESEND_API_KEY!);
  return client;
}

/**
 * Lightweight deliverability check: confirm the address is syntactically valid
 * and its domain has MX (mail) records. Only enforced when EMAIL_VERIFY_MX=true;
 * otherwise returns ok so demo domains (e.g. @test.com) aren't blocked.
 * Returns { ok, reason? } rather than throwing so callers control the response.
 */
export async function verifyEmailDeliverable(email: string): Promise<{ ok: boolean; reason?: string }> {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return { ok: false, reason: 'Invalid email address' };
  if (!env.EMAIL_VERIFY_MX) return { ok: true };

  const domain = email.slice(at + 1).toLowerCase();
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length > 0) return { ok: true };
    return { ok: false, reason: `The domain "${domain}" cannot receive email` };
  } catch {
    return { ok: false, reason: `The domain "${domain}" cannot receive email` };
  }
}

function loginUrl(): string {
  return env.APP_WEB_URL || allowedOrigins[0] || 'the web console';
}

export interface CredentialsEmailParams {
  to: string; name: string; email: string; password: string; role?: string; uid?: string | null;
}

/**
 * Render the credentials email. Split out from the send so its contents can be
 * asserted in tests without configuring or contacting Resend.
 *
 * On the "change your password" instruction: this application has no
 * change-password screen — there is no such endpoint, no web page, and the
 * mobile Profile screen only shows name/email/role and Sign Out. So the email
 * points at "Forgot password", which is the only self-service route that
 * actually exists and works on both web and mobile. If a change-password
 * feature is added later, this wording should be revisited.
 */
export function buildCredentialsEmail(params: CredentialsEmailParams): {
  subject: string; text: string; html: string;
} {
  const url = loginUrl();
  const roleLine = params.role ? `\nRole: ${params.role}` : '';
  const uidLine = params.uid ? `\nUser ID: ${params.uid}` : '';

  const text =
    `Hello ${params.name},\n\n` +
    `An account has been created for you on the VBL Signage platform.\n\n` +
    `Login page: ${url}\n` +
    `Email (username): ${params.email}${uidLine}\n` +
    `Temporary password: ${params.password}${roleLine}\n\n` +
    `Sign in with the temporary password above.\n` +
    `To replace it with a password of your own, use "Forgot password" on the ` +
    `sign-in page and follow the emailed link.\n` +
    `Please do not share or forward this email — it contains your password.\n\n` +
    `— VBL Signage`;

  const row = (label: string, value: string, mono = false) =>
    `<tr><td style="padding:4px 10px;color:#666">${label}</td>` +
    `<td style="padding:4px 10px"><b${mono ? ' style="font-family:monospace;font-size:15px"' : ''}>${escapeHtml(value)}</b></td></tr>`;

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>Hello <b>${escapeHtml(params.name)}</b>,</p>` +
    `<p>An account has been created for you on the <b>VBL Signage</b> platform.</p>` +
    `<table style="border-collapse:collapse;margin:12px 0">` +
    `<tr><td style="padding:4px 10px;color:#666">Login page</td><td style="padding:4px 10px"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></td></tr>` +
    row('Email (username)', params.email) +
    (params.uid ? row('User ID', params.uid) : '') +
    row('Temporary password', params.password, true) +
    (params.role ? row('Role', params.role) : '') +
    `</table>` +
    `<p style="color:#666">Sign in with the temporary password above. To replace it with a password of ` +
    `your own, use “Forgot password” on the sign-in page and follow the emailed link.</p>` +
    `<p style="color:#666">Please do not share or forward this email — it contains your password.</p>` +
    `<p>— VBL Signage</p></div>`;

  return { subject: 'Your VBL Signage account', text, html };
}

/**
 * Email a freshly-created account its login credentials, including the
 * system-generated temporary password.
 *
 * This is the ONLY place the plaintext temporary password is used. It is
 * bcrypt-hashed before storage, is never written to the database or a log, and
 * is never returned in an API response — so this email is the single channel by
 * which it reaches its owner. Note the deliberate consequence: if the send
 * fails, the password is unrecoverable and the account must use Forgot Password.
 *
 * Returns true if sent, false if email isn't configured or the send failed.
 * Never throws — credential delivery must not fail account creation. The
 * failure log below records the recipient only, never the password.
 */
export async function sendCredentialsEmail(params: CredentialsEmailParams): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;

  const { subject, text, html } = buildCredentialsEmail(params);

  try {
    const { error } = await resend.emails.send({
      from: env.RESEND_FROM, to: params.to, subject, text, html,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    // Recipient only — never the password.
    console.error(`Failed to send credentials email to ${params.to}:`, (e as Error).message);
    return false;
  }
}

/**
 * Confirm to a vendor that their company has been registered.
 *
 * A vendor is a master record, not a login — so this deliberately carries no
 * credentials and no sign-in link. Vendor Admin / Vendor User accounts are
 * created separately as users, and those receive their own credentials email.
 */
export async function sendVendorWelcomeEmail(params: {
  to: string; vendorName: string; vendorUid: string; contactPerson?: string | null;
}): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;

  const greeting = params.contactPerson ? `Hello ${params.contactPerson},` : 'Hello,';
  const text =
    `${greeting}\n\n` +
    `${params.vendorName} has been registered as a vendor on the VBL Signage platform.\n\n` +
    `Vendor name: ${params.vendorName}\n` +
    `Vendor UID: ${params.vendorUid}\n\n` +
    `Please quote this Vendor UID in any correspondence about signage work.\n` +
    `User accounts for your team are set up separately — anyone who needs access ` +
    `will receive their own email.\n\n` +
    `— VBL Signage`;

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>${escapeHtml(greeting)}</p>` +
    `<p><b>${escapeHtml(params.vendorName)}</b> has been registered as a vendor on the <b>VBL Signage</b> platform.</p>` +
    `<table style="border-collapse:collapse;margin:12px 0">` +
    `<tr><td style="padding:4px 10px;color:#666">Vendor name</td><td style="padding:4px 10px"><b>${escapeHtml(params.vendorName)}</b></td></tr>` +
    `<tr><td style="padding:4px 10px;color:#666">Vendor UID</td><td style="padding:4px 10px"><b>${escapeHtml(params.vendorUid)}</b></td></tr>` +
    `</table>` +
    `<p style="color:#666">Please quote this Vendor UID in any correspondence about signage work. ` +
    `User accounts for your team are set up separately — anyone who needs access will receive their own email.</p>` +
    `<p>— VBL Signage</p></div>`;

  try {
    const { error } = await resend.emails.send({
      from: env.RESEND_FROM, to: params.to, subject: `${params.vendorName} is registered on VBL Signage`, text, html,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error(`Failed to send vendor welcome email to ${params.to}:`, (e as Error).message);
    return false;
  }
}

/**
 * Email a password reset link. Same best-effort contract as sendCredentialsEmail:
 * returns true if sent, false if email isn't configured or the send failed, never throws.
 */
export async function sendPasswordResetEmail(params: { to: string; name: string; resetUrl: string }): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;

  const text =
    `Hello ${params.name},\n\n` +
    `We received a request to reset your VBL Signage password.\n\n` +
    `Reset your password: ${params.resetUrl}\n\n` +
    `This link expires in 1 hour. If you didn't request this, you can safely ignore this email.\n\n` +
    `— VBL Signage`;

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>Hello <b>${escapeHtml(params.name)}</b>,</p>` +
    `<p>We received a request to reset your <b>VBL Signage</b> password.</p>` +
    `<p><a href="${escapeHtml(params.resetUrl)}" style="display:inline-block;padding:10px 18px;background:#0B5CAD;color:#fff;text-decoration:none;border-radius:6px">Reset your password</a></p>` +
    `<p style="color:#666;font-size:12px">Or copy this link: ${escapeHtml(params.resetUrl)}</p>` +
    `<p style="color:#666">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>` +
    `<p>— VBL Signage</p></div>`;

  try {
    const { error } = await resend.emails.send({
      from: env.RESEND_FROM, to: params.to, subject: 'Reset your VBL Signage password', text, html,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error(`Failed to send password reset email to ${params.to}:`, (e as Error).message);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}
