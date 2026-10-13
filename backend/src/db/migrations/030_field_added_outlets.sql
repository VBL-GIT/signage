-- Field-added outlets: an employee can recee a brand-new outlet that was never
-- assigned. The outlet is created as a real store row, flagged so head office
-- can review it and set the real Customer Code later.
--
-- ADDITIVE ONLY and idempotent. Existing rows keep the defaults (false / NULL).

ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_field_added BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks  ADD COLUMN IF NOT EXISTS is_field_initiated BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_stores_field_added ON stores (is_field_added) WHERE is_field_added;

-- ROLLBACK (manual):
--   DROP INDEX IF EXISTS idx_stores_field_added;
--   ALTER TABLE tasks  DROP COLUMN IF EXISTS is_field_initiated;
--   ALTER TABLE stores DROP COLUMN IF EXISTS added_by;
--   ALTER TABLE stores DROP COLUMN IF EXISTS is_field_added;
--   DELETE FROM _migrations WHERE filename = '030_field_added_outlets.sql';
