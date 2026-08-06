-- Prevent duplicate vendor contact emails. Case-insensitive, and only enforced
-- when an email is actually set (existing vendors with a NULL email are fine).
-- The controller does a friendly pre-check first; this index is the hard
-- backstop against race conditions (two concurrent creates with the same email).
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_contact_email_unique
  ON vendors (lower(contact_email))
  WHERE contact_email IS NOT NULL;
