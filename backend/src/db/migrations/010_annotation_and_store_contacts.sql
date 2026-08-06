-- Sprint 6:
--  1) Freehand annotation (drawn strokes) saved per recee signage photo.
--  2) Store contact person + email, shown to the employee on the task page.
-- Safe to run multiple times.

ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS annotation TEXT;

ALTER TABLE stores ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS contact_person VARCHAR(150);
