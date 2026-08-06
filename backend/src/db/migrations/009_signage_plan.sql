-- Sprint 5: an installation task carries a predetermined "signage plan" — the list
-- of signages to install, each with its size / brand / type. The employee does NOT
-- choose these; they only photograph each planned signage on site.
--
-- post_recee plans are derived on read from the source recee's signages, so only
-- direct_boarding (no-recee) installation tasks store rows here.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS task_signage_plan (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  signage_index    INTEGER NOT NULL,
  signage_type     VARCHAR(20),
  boarding_size_id UUID REFERENCES standard_boarding_sizes(id) ON DELETE SET NULL,
  custom_width_cm  INTEGER,
  custom_height_cm INTEGER,
  brand_id         UUID REFERENCES brands(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_signage_plan_task ON task_signage_plan(task_id);

ALTER TABLE task_signage_plan DROP CONSTRAINT IF EXISTS tsplan_signage_type_check;
ALTER TABLE task_signage_plan ADD CONSTRAINT tsplan_signage_type_check
  CHECK (signage_type IS NULL OR signage_type IN ('nonlit', 'glow_sign_board', 'impact'));
