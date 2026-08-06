-- Sprint 4: add a third installation flavor — a direct boarding installation
-- (a board installed at a store WITHOUT a prior recee). The existing 'direct'
-- continues to mean pamphlet distribution; 'post_recee' is unchanged.
-- Safe to run multiple times.

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_installation_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_installation_type_check
  CHECK (installation_type IN ('post_recee', 'direct', 'direct_boarding'));
