-- Sprint 10: standardise all vendor UIDs to the auto-generated VND-NNN format,
-- derived from each vendor's numeric code. Safe to run multiple times.
UPDATE vendors SET uid = 'VND-' || LPAD(code::text, 3, '0') WHERE code IS NOT NULL;
