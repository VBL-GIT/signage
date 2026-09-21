-- Backfill: give every stranded post_recee installation its recee's employee.
--
-- processReceeApproval created the installation task with employee_id NULL, and
-- an employee's task list is filtered to `employee_id = me`. So an approved
-- recee produced an installation nobody could see: the recee went to Done and
-- the follow-up work disappeared until someone hand-assigned it on the web.
-- tasks.service.ts now carries the recee's employee and supervisor onto the new
-- task; this fixes the ones already created.
--
-- Only unassigned, unfinished installs are touched, and only where the parent
-- recee actually has someone to inherit. A completed install is left exactly as
-- it is — its history is what it is, and rewriting who it belonged to would
-- falsify the record.
--
-- Idempotent: re-running changes nothing, because every row it would match has
-- an employee_id afterwards.

UPDATE tasks c
   SET employee_id  = p.employee_id,
       supervisor_id = COALESCE(c.supervisor_id, p.supervisor_id),
       assigned_at  = COALESCE(c.assigned_at, NOW()),
       updated_at   = NOW()
  FROM tasks p
 WHERE c.parent_task_id = p.id
   AND c.installation_type = 'post_recee'
   AND c.employee_id IS NULL
   AND p.employee_id IS NOT NULL
   AND c.status <> 'completed';
