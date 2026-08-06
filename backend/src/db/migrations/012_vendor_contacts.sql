-- Sprint 10: vendor contact details. (is_active already exists on vendors & users.)
-- Safe to run multiple times.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_person VARCHAR(150);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);
