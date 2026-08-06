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

/**
 * Email the freshly-created account its login credentials.
 * Returns true if sent, false if email isn't configured or the send failed.
 * Never throws — credential delivery must not fail account creation.
 */
export async function sendCredentialsEmail(params: {
  to: string; name: string; email: string; password: string; role?: string;
}): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;

  const url = loginUrl();
  const roleLine = params.role ? `\nRole: ${params.role}` : '';

  const text =
    `Hello ${params.name},\n\n` +
    `An account has been created for you on the VBL Signage platform.\n\n` +
    `Login: ${url}\n` +
    `Email: ${params.email}\n` +
    `Password: ${params.password}${roleLine}\n\n` +
    `For your security, please change your password after your first login.\n\n` +
    `— VBL Signage`;

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>Hello <b>${escapeHtml(params.name)}</b>,</p>` +
    `<p>An account has been created for you on the <b>VBL Signage</b> platform.</p>` +
    `<table style="border-collapse:collapse;margin:12px 0">` +
    `<tr><td style="padding:4px 10px;color:#666">Login</td><td style="padding:4px 10px"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></td></tr>` +
    `<tr><td style="padding:4px 10px;color:#666">Email</td><td style="padding:4px 10px"><b>${escapeHtml(params.email)}</b></td></tr>` +
    `<tr><td style="padding:4px 10px;color:#666">Password</td><td style="padding:4px 10px"><b>${escapeHtml(params.password)}</b></td></tr>` +
    (params.role ? `<tr><td style="padding:4px 10px;color:#666">Role</td><td style="padding:4px 10px">${escapeHtml(params.role)}</td></tr>` : '') +
    `</table>` +
    `<p style="color:#666">For your security, please change your password after your first login.</p>` +
    `<p>— VBL Signage</p></div>`;

  try {
    const { error } = await resend.emails.send({
      from: env.RESEND_FROM, to: params.to, subject: 'Your VBL Signage account', text, html,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error(`Failed to send credentials email to ${params.to}:`, (e as Error).message);
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
