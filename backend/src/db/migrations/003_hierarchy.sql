-- Sprint 2: Multi-tier user hierarchy (RJCorp / Vendor / Employee)
-- Safe to run multiple times.

-- ============================================================
-- 1. USERS: expand role set, add first/last name
-- ============================================================

-- Drop the old CHECK first so the role migration is allowed, then re-add the widened one
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = 'vendor_admin' WHERE role = 'supervisor';

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('rjcorp_admin', 'rjcorp_user', 'vendor_admin', 'vendor_user', 'employee'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name  VARCHAR(255);

-- Best-effort backfill of first/last from the legacy single name column
UPDATE users
SET first_name = COALESCE(first_name, split_part(name, ' ', 1)),
    last_name  = COALESCE(last_name,
                          NULLIF(substring(name from position(' ' in name) + 1), name))
WHERE first_name IS NULL;

-- ============================================================
-- 2. VENDORS: add UID number (unique identifier from onboarding)
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS uid VARCHAR(100);
-- Backfill any existing rows so we can enforce uniqueness, then constrain
UPDATE vendors SET uid = 'VENDOR-' || substr(id::text, 1, 8) WHERE uid IS NULL;
ALTER TABLE vendors ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_uid ON vendors(uid);

-- ============================================================
-- 3. TASKS: add vendor_id, make employee_id nullable
--    (RJCorp creates the task against a vendor; vendor assigns the employee later)
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE tasks ALTER COLUMN employee_id DROP NOT NULL;

-- ============================================================
-- 4. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_vendor ON users(vendor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_vendor ON tasks(vendor_id);
