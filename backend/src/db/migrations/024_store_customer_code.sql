-- Sprint 13: Customer-Code store identity + master duplicate integrity.
--
-- ADDITIVE ONLY. No column is dropped, renamed or made NOT NULL, and no row
-- data is rewritten. Safe to run multiple times (every statement is guarded).
--
-- Why nothing becomes NOT NULL: live data has stores with a NULL uid that are
-- referenced by existing tasks, and every store predates customer_code. Both
-- identifiers are therefore nullable in the database and mandatory only at the
-- API layer for NEW creates/upserts, so legacy rows keep working untouched.

-- ============================================================
-- 1. STORES: Customer Code — the business key that decides
--    create-vs-update on manual entry, bulk import and API.
-- ============================================================
ALTER TABLE stores ADD COLUMN IF NOT EXISTS customer_code VARCHAR(50);

-- Case-insensitive uniqueness, enforced only where a code is actually set, so
-- the 14 existing stores (all NULL) are unaffected. This index is the hard
-- backstop against the check-then-insert race on concurrent upserts; the
-- controller still pre-checks first to produce a friendly message.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_customer_code
  ON stores (lower(customer_code))
  WHERE customer_code IS NOT NULL;

-- ============================================================
-- 2. STORES: outlet status (CUST_STATUS in the customer master).
--    Stored and displayed only — deliberately drives no behaviour
--    (task creation is NOT gated on it) until the business
--    confirms the value set and the rule.
-- ============================================================
ALTER TABLE stores ADD COLUMN IF NOT EXISTS outlet_status VARCHAR(30);

-- ============================================================
-- 3. STORES: raw source row from a customer-master ("speed dump")
--    import. That file carries ~40 columns with no home in this
--    schema; rather than inventing 40 columns or silently dropping
--    them, the whole original row is preserved verbatim as JSONB.
--    Written only by the customer-master import channel; NULL for
--    stores created any other way.
-- ============================================================
ALTER TABLE stores ADD COLUMN IF NOT EXISTS source_metadata JSONB;

-- ============================================================
-- 4. STORES: case-insensitive Store UID lookup.
--    The task bulk importer already resolves store_uid case-
--    insensitively (lower(uid)) while the existing stores_uid_key
--    constraint is case-SENSITIVE — so 'ST-1' and 'st-1' could both
--    exist and the importer would silently pick one. This closes
--    that gap. Verified safe: 0 case-insensitive collisions in the
--    9 stores that currently have a uid.
--    NOTE: the original stores_uid_key is intentionally left in
--    place; this index is an additional, stricter guarantee.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_uid_lower
  ON stores (lower(uid))
  WHERE uid IS NOT NULL;

-- ============================================================
-- 5. BRANDS: prevent duplicate brand names (case-insensitive).
--    brands had no uniqueness at all, so 'Pepsi' / 'PEPSI' could
--    both be created and then collide by name in the task importer.
--    Verified safe: 1 brand row, 0 duplicates.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_name_unique
  ON brands (lower(name));

-- ============================================================
-- ROLLBACK (manual — this project's runner has no down-migrations):
--   DROP INDEX IF EXISTS idx_brands_name_unique;
--   DROP INDEX IF EXISTS idx_stores_uid_lower;
--   DROP INDEX IF EXISTS idx_stores_customer_code;
--   ALTER TABLE stores DROP COLUMN IF EXISTS source_metadata;
--   ALTER TABLE stores DROP COLUMN IF EXISTS outlet_status;
--   ALTER TABLE stores DROP COLUMN IF EXISTS customer_code;
--   DELETE FROM _migrations WHERE filename = '024_store_customer_code.sql';
-- Dropping the added columns discards only data this migration introduced;
-- no pre-existing column or row is touched by either direction.
-- ============================================================
