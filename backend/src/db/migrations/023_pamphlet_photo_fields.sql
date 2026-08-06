-- Per-photo fields for pamphlet (direct installation) distribution.
-- The field employee captures one photo per drop point; each photo carries its
-- own GPS (existing lat/long columns), the store/area it was taken at, and the
-- brand of the pamphlet. Both are free text entered on the phone. brand_label
-- is distinct from the boarding brand_id FK — pamphlet brands aren't in the
-- brands table.
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS area_label TEXT;
ALTER TABLE task_step_photos ADD COLUMN IF NOT EXISTS brand_label TEXT;
