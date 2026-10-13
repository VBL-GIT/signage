-- Idempotency key for employee-initiated (field) recees. The app keeps the same
-- key for every retry of one submission, so a request whose response was lost on a
-- weak connection can be re-sent without creating a second outlet and task.
-- ADDITIVE ONLY and idempotent.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_client_request_id
  ON tasks (client_request_id)
  WHERE client_request_id IS NOT NULL;

-- ROLLBACK (manual):
--   DROP INDEX IF EXISTS idx_tasks_client_request_id;
--   ALTER TABLE tasks DROP COLUMN IF EXISTS client_request_id;
--   DELETE FROM _migrations WHERE filename = '031_task_client_request_id.sql';
