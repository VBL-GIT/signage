-- 027: a recoverable copy of an account's current password.
--
-- Requested so RJCorp admins can read any account's password and vendor admins
-- their own employees', from the user's detail page.
--
-- password_hash is unchanged and remains the ONLY thing login checks. This
-- column is a separate, encrypted copy kept purely so it can be shown back.
--
-- SECURITY NOTES — read before touching this column:
--   * The value is AES-256-GCM ciphertext, never plaintext. The key lives in
--     CREDENTIAL_ENC_KEY in the environment, never in the database, so a dump
--     of this table alone does not reveal any password.
--   * With no CREDENTIAL_ENC_KEY set, nothing is written here and nothing can
--     be read back — the feature is simply off.
--   * It is NULL for every account that predates this migration. A bcrypt hash
--     cannot be reversed, so existing passwords are not recoverable; a user's
--     password only becomes viewable after it is next set or reset.
--   * This is a deliberate trade of confidentiality for operability. Whoever
--     can read this column can impersonate those users on any system where
--     they reused the password.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_encrypted TEXT;

COMMENT ON COLUMN users.password_encrypted IS
  'AES-256-GCM ciphertext of the current password, for admin viewing only. Never used to authenticate — password_hash is. NULL where unavailable.';
