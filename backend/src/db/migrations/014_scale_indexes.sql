-- Performance indexes for the access patterns that matter at scale
-- (role/vendor/store/status filtering, recent-first ordering). Safe to run repeatedly.
CREATE INDEX IF NOT EXISTS idx_tasks_vendor      ON tasks(vendor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_employee    ON tasks(employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_store       ON tasks(store_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at  ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_vendor_status ON tasks(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_stores_vendor     ON stores(vendor_id);
CREATE INDEX IF NOT EXISTS idx_users_vendor      ON users(vendor_id);
