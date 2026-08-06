-- Task age / completion / reassignment tracking.
-- completed_at:      when the task reached 'completed' (age vs. days-to-complete).
-- assigned_at:       timestamp of the most recent (re)assignment.
-- assignment_count:  number of times the task has been assigned via the assign
--                    endpoints. >= 2 means it has been reassigned at least once.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignment_count INTEGER NOT NULL DEFAULT 0;

-- Backfill completed_at for already-completed tasks from their last recorded
-- step (falling back to updated_at when a task has no steps).
UPDATE tasks t
   SET completed_at = COALESCE(
     (SELECT MAX(ts.timestamp) FROM task_steps ts WHERE ts.task_id = t.id),
     t.updated_at)
 WHERE t.status = 'completed' AND t.completed_at IS NULL;

-- Seed assignment_count = 1 for tasks that already have an employee so a future
-- reassignment correctly registers as the 2nd assignment. assigned_at stays NULL
-- for historical assignments (the timestamp is unknown), so no false
-- "days since reassignment" is shown until the task is next reassigned.
UPDATE tasks SET assignment_count = 1 WHERE employee_id IS NOT NULL AND assignment_count = 0;
