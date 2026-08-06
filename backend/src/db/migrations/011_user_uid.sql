-- Sprint 9: auto-generated employee/user UID that encodes the vendor.
--  - vendors.code: a small sequential number per vendor (1, 2, 3 …)
--  - users.uid: e.g. "V1-E001" => vendor #1, employee #001. Mutable, so it can
--    later be overwritten with UIDs from VBL's master record.
-- Safe to run multiple times.

-- Users get a (nullable, unique) uid. NULLs are allowed for rjcorp accounts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS uid VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uid ON users(uid);

-- Vendors get a sequential numeric code.
CREATE SEQUENCE IF NOT EXISTS vendors_code_seq;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS code INTEGER;

-- Backfill codes for any existing vendors that don't have one yet.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM vendors WHERE code IS NULL
)
UPDATE vendors v
SET code = o.rn + COALESCE((SELECT MAX(code) FROM vendors), 0)
FROM ordered o
WHERE v.id = o.id;

-- Next inserted vendor continues the sequence (false => nextval returns this value).
SELECT setval('vendors_code_seq', (SELECT COALESCE(MAX(code), 0) FROM vendors) + 1, false);
ALTER TABLE vendors ALTER COLUMN code SET DEFAULT nextval('vendors_code_seq');
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_code ON vendors(code);

-- Backfill UIDs for existing vendor-scoped users (V{code}-{letter}{seq} per vendor+role).
WITH numbered AS (
  SELECT u.id, v.code, u.role,
         ROW_NUMBER() OVER (PARTITION BY u.vendor_id, u.role ORDER BY u.created_at, u.id) AS rn
  FROM users u JOIN vendors v ON v.id = u.vendor_id
  WHERE u.uid IS NULL AND u.role IN ('employee', 'vendor_admin', 'vendor_user')
)
UPDATE users u
SET uid = 'V' || n.code || '-' ||
          CASE n.role WHEN 'employee' THEN 'E' WHEN 'vendor_admin' THEN 'A' ELSE 'U' END ||
          LPAD(n.rn::text, 3, '0')
FROM numbered n
WHERE u.id = n.id;
