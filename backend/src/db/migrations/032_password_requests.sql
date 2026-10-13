-- Forgot-password is now an admin-handled request instead of an emailed link:
-- the user asks, an admin sets a new password on the web console and passes it on.
-- ADDITIVE ONLY and idempotent.

CREATE TABLE IF NOT EXISTS password_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What the requester typed, so an admin can sanity-check who is asking.
  entered_name  VARCHAR(255),
  entered_mobile VARCHAR(30),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES users(id) ON DELETE SET NULL
);

-- One open request per account: repeated taps refresh it instead of piling up.
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_requests_one_pending
  ON password_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_password_requests_status ON password_requests (status, created_at DESC);

-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS password_requests;
--   DELETE FROM _migrations WHERE filename = '032_password_requests.sql';
