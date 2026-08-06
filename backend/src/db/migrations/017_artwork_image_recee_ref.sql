-- Artwork gains an optional reference image (shown to the installing employee).
-- task_signage_plan remembers which ORIGINAL recee signage each plan row came
-- from, so the install screen can show that recee photo for reference even when
-- the recee was only partially approved (plan rows are re-indexed 1..N).
-- Safe to run multiple times.

ALTER TABLE artworks          ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE task_signage_plan ADD COLUMN IF NOT EXISTS recee_signage_index INTEGER;
