-- 034: audit trail of changes made through the console, attributed to the account
-- (email) that made them. Append-only. ADDITIVE ONLY and idempotent.
--
-- actor_email / actor_name / actor_role are stored on the row (not just joined) so
-- a change stays attributable to the email that made it even if the account is
-- later renamed or removed.
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email   VARCHAR(255) NOT NULL,
  actor_name    VARCHAR(255),
  actor_role    VARCHAR(50),
  action        VARCHAR(120) NOT NULL,
  description   TEXT NOT NULL,
  entity_type   VARCHAR(40),
  entity_id     TEXT,
  entity_label  TEXT,
  details       JSONB,
  ip            VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (lower(actor_email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS audit_log;
--   DELETE FROM _migrations WHERE filename = '034_audit_log.sql';
