-- Vendor UID is auto-generated from vendors.code immediately AFTER insert
-- (VND-NNN), so the row must be insertable without a uid first. The original
-- NOT NULL made both the Create-Vendor form and bulk vendor import fail.
-- The unique index still prevents duplicates.
ALTER TABLE vendors ALTER COLUMN uid DROP NOT NULL;
