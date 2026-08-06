-- Sprint 5: per-signage recee & installation.
-- Each photo in task_step_photos now represents one signage, carrying its own
-- GPS, size, signage type, (brand for installs) and pre-computed distances.
-- Safe to run multiple times.

ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS lat NUMERIC;
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS long NUMERIC;
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS signage_type VARCHAR(20);
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS boarding_size_id UUID REFERENCES standard_boarding_sizes(id) ON DELETE SET NULL;
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS custom_width_cm INTEGER;
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS custom_height_cm INTEGER;
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS distance_from_store_m NUMERIC;
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS distance_from_first_m NUMERIC;
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS distance_from_recee_m NUMERIC;
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS signage_index INTEGER;

ALTER TABLE task_step_photos DROP CONSTRAINT IF EXISTS tsp_signage_type_check;
ALTER TABLE task_step_photos ADD CONSTRAINT tsp_signage_type_check
  CHECK (signage_type IS NULL OR signage_type IN ('nonlit', 'glow_sign_board', 'impact'));
