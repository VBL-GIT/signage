-- 026: make Customer Code the single store identifier.
--
-- Store UID and Customer Code were two identifiers for one thing. Customer Code
-- is now the only one the console shows or a template collects. This migration
-- makes that safe by guaranteeing every store already has one.
--
-- stores.uid is deliberately NOT dropped and NOT rewritten:
--   * tasks, images and older spreadsheets still reference stores by uid, and
--     rewriting it would break those references;
--   * keeping it lets this change be reversed by putting the field back.
-- It simply stops being collected or displayed.
--
-- Two groups need a code, and neither overwrites an existing value:
--   1. a uid but no customer_code  -> copy the uid across
--   2. neither                     -> synthesise STR-nnnn, ordered by created_at
--
-- Verified before writing: no duplicate uids, and no uid collides with an
-- existing customer_code, so step 1 cannot violate the unique index.

BEGIN;

-- 1. Stores identified only by uid: adopt it as the customer code.
UPDATE stores
   SET customer_code = uid
 WHERE customer_code IS NULL
   AND uid IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM stores o
          WHERE o.id <> stores.id
            AND lower(o.customer_code) = lower(stores.uid)
       );

-- 2. Stores with no identifier at all: give them a synthetic, obviously
--    placeholder code so they stay editable and upsertable. The suffix
--    continues past any STR-nnnn already in use, so re-running is safe.
WITH start AS (
  SELECT COALESCE(MAX(NULLIF(regexp_replace(customer_code, '^STR-', ''), '')::int), 0) AS n
    FROM stores
   WHERE customer_code ~ '^STR-[0-9]+$'
),
needing AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM stores
   WHERE customer_code IS NULL
)
UPDATE stores s
   SET customer_code = 'STR-' || lpad((start.n + needing.rn)::text, 4, '0')
  FROM needing, start
 WHERE s.id = needing.id;

-- 3. Backstop: a store with no customer code can no longer be identified in the
--    console, so fail loudly here rather than discovering it in production.
DO $$
DECLARE missing int;
BEGIN
  SELECT COUNT(*) INTO missing FROM stores WHERE customer_code IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % store(s) still have no customer_code', missing;
  END IF;
END $$;

COMMIT;

COMMENT ON COLUMN stores.customer_code IS
  'The store''s single business identifier, shown as "Customer Code". Upsert key for both the store form and every bulk upload.';
COMMENT ON COLUMN stores.uid IS
  'Legacy identifier, superseded by customer_code. No longer collected or displayed; retained because tasks, images and older spreadsheets still reference stores by it.';
