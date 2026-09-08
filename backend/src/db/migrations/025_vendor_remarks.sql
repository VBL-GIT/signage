-- 025: free-text remarks on a vendor.
--
-- The vendor bulk template gained a `remarks` column, and the value has to
-- land somewhere or it would be silently discarded on upload. Additive and
-- nullable: existing rows are untouched and nothing is rewritten.
--
-- TEXT rather than VARCHAR(n) — this is an operator's note with no natural
-- length limit, and the API caps it instead.

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS remarks TEXT;

COMMENT ON COLUMN vendors.remarks IS
  'Free-text note about the vendor. Set from the vendor bulk upload or the vendor form; never used in any business rule.';
