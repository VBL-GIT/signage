-- Artwork = a named design/code under a brand. One brand has many artworks.
-- RJCorp sets an artwork (alongside brand + size) for each installation signage:
--   - post_recee     → chosen per-signage at recee approval (stored in task_signage_plan)
--   - direct_boarding → chosen at task creation (stored on the task + its plan row)
-- The installing employee sees the artwork name for each planned signage.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS artworks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id   UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One artwork name per brand (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS idx_artworks_brand_name ON artworks(brand_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_artworks_brand ON artworks(brand_id);

ALTER TABLE task_signage_plan ADD COLUMN IF NOT EXISTS artwork_id UUID REFERENCES artworks(id) ON DELETE SET NULL;
ALTER TABLE tasks            ADD COLUMN IF NOT EXISTS artwork_id UUID REFERENCES artworks(id) ON DELETE SET NULL;
