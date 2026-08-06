-- Sprint 3: Recee / Installation restructure (multi-photo + marking)
-- Safe to run multiple times.

-- ============================================================
-- 1. TASKS: new task_type set, installation subtype, spec fields
-- ============================================================
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;

-- Best-effort mapping of old types to new ones (demo data; reset-tasks.ts replaces it anyway)
UPDATE tasks SET task_type = 'recee' WHERE task_type = 'recee_approval_installation';
UPDATE tasks SET task_type = 'installation' WHERE task_type IN ('installation_only', 'pamphlet_distribution');

ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN ('recee', 'installation'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS installation_type VARCHAR(20)
  CHECK (installation_type IN ('post_recee', 'direct'));

-- Best-effort: any pre-existing installation rows become 'direct'
UPDATE tasks SET installation_type = 'direct' WHERE task_type = 'installation' AND installation_type IS NULL;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS boarding_size_id UUID REFERENCES standard_boarding_sizes(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS custom_width_cm INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS custom_height_cm INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_pamphlet_count INTEGER;

-- ============================================================
-- 2. TASK_STEPS: narrow step_type set
-- ============================================================
ALTER TABLE task_steps DROP CONSTRAINT IF EXISTS task_steps_step_type_check;

-- Best-effort: drop legacy pamphlet_drop steps (folded into 'installation' going forward)
UPDATE task_steps SET step_type = 'installation' WHERE step_type = 'pamphlet_drop';

ALTER TABLE task_steps ADD CONSTRAINT task_steps_step_type_check
  CHECK (step_type IN ('recee', 'approval', 'installation'));

-- photo_url stays for back-compat with old rows; new rows use task_step_photos

-- ============================================================
-- 3. TASK_STEP_PHOTOS: multi-photo + marking
-- ============================================================
CREATE TABLE IF NOT EXISTS task_step_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_step_id UUID NOT NULL REFERENCES task_steps(id) ON DELETE CASCADE,
  photo_url    TEXT NOT NULL,
  marker_x     DECIMAL(5,4),
  marker_y     DECIMAL(5,4),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_step_photos_step ON task_step_photos(task_step_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
