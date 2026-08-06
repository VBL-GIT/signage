-- System-generated artwork UID, same pattern as vendors (code sequence -> ART-NNN).
-- Safe to run multiple times.

CREATE SEQUENCE IF NOT EXISTS artworks_code_seq;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS code INTEGER;
ALTER TABLE artworks ALTER COLUMN code SET DEFAULT nextval('artworks_code_seq');
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS uid VARCHAR(20);

-- Backfill codes for any existing rows without one, ordered by creation time.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
  FROM artworks WHERE code IS NULL
)
UPDATE artworks a
SET code = o.rn + COALESCE((SELECT MAX(code) FROM artworks), 0)
FROM ordered o WHERE a.id = o.id;

SELECT setval('artworks_code_seq', (SELECT COALESCE(MAX(code), 0) FROM artworks) + 1, false);

-- Backfill uid from code for any rows missing it.
UPDATE artworks SET uid = 'ART-' || LPAD(code::text, 3, '0') WHERE uid IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_artworks_uid ON artworks(uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artworks_code ON artworks(code);
