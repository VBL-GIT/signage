-- 033: Assigned/Unassigned activity origin, SPEED classification, duplicate flags,
-- assignment history and a reference image per outlet.
-- ADDITIVE ONLY and idempotent. Nothing is dropped or rewritten except the
-- documented backfill of activity_origin from the existing is_field_initiated flag.

-- ---- Activity origin: an explicit, persistent classification (NOT inferred from
-- whether an employee is assigned). Existing admin-created work is ASSIGNED.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS activity_origin VARCHAR(12) NOT NULL DEFAULT 'ASSIGNED';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_activity_origin_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_activity_origin_check CHECK (activity_origin IN ('ASSIGNED', 'UNASSIGNED'));
UPDATE tasks SET activity_origin = 'UNASSIGNED' WHERE is_field_initiated AND activity_origin <> 'UNASSIGNED';
-- A post-recee installation inherits the origin of the recee it was spawned from.
UPDATE tasks c SET activity_origin = p.activity_origin
  FROM tasks p
 WHERE c.parent_task_id = p.id AND c.activity_origin <> p.activity_origin AND p.activity_origin = 'UNASSIGNED';

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_origin_created ON tasks (activity_origin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_vendor_created ON tasks (vendor_id, created_at DESC);

-- ---- Outlet classification. NULL = not recorded (every outlet imported from the
-- customer master predates this), reported as "Not recorded", never guessed.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_speed BOOLEAN;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS speed_id VARCHAR(50);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_speed_id ON stores (lower(speed_id)) WHERE speed_id IS NOT NULL;
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_speed_id_requires_speed;
ALTER TABLE stores ADD CONSTRAINT stores_speed_id_requires_speed CHECK (speed_id IS NULL OR is_speed IS TRUE);

-- ---- Possible duplicates, flagged for review (never merged automatically):
-- [{ "store_id": "...", "reasons": ["within 120 m", "same name + pincode"] }]
ALTER TABLE stores ADD COLUMN IF NOT EXISTS duplicate_candidates JSONB;

-- ---- Historical/reference photograph of the outlet, kept apart from activity photos.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS reference_image_url TEXT;

-- ---- Assignment history: who held a task, who moved it, and why. Append-only.
CREATE TABLE IF NOT EXISTS task_assignment_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_employee_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  task_status      VARCHAR(50),
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_assignment_history_task ON task_assignment_history (task_id, created_at);

-- Backfill: one row for every task that already has an employee, so "original
-- assigned employee" exists for old work too. assigned_by is unknown for these.
INSERT INTO task_assignment_history (task_id, from_employee_id, to_employee_id, assigned_by, task_status, note, created_at)
SELECT t.id, NULL, t.employee_id, NULL, t.status, 'backfilled', COALESCE(t.assigned_at, t.created_at)
  FROM tasks t
 WHERE t.employee_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM task_assignment_history h WHERE h.task_id = t.id);

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS task_assignment_history;
--   ALTER TABLE stores DROP COLUMN IF EXISTS reference_image_url, DROP COLUMN IF EXISTS duplicate_candidates;
--   ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_speed_id_requires_speed;
--   DROP INDEX IF EXISTS idx_stores_speed_id;
--   ALTER TABLE stores DROP COLUMN IF EXISTS speed_id, DROP COLUMN IF EXISTS is_speed;
--   DROP INDEX IF EXISTS idx_tasks_vendor_created; DROP INDEX IF EXISTS idx_tasks_origin_created;
--   ALTER TABLE tasks DROP COLUMN IF EXISTS created_by;
--   ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_activity_origin_check;
--   ALTER TABLE tasks DROP COLUMN IF EXISTS activity_origin;
--   DELETE FROM _migrations WHERE filename = '033_activity_origin_speed_reassign.sql';
