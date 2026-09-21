-- Adds a 'cancelled' status so a task can be deleted (soft) from the admin
-- console without losing its task_steps audit trail.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN (
  'pending',
  'recee_submitted',
  'recee_approved',
  'recee_rejected',
  'installed',
  'completed',
  'cancelled'
));
