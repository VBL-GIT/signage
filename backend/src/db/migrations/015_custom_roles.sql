-- Sprint 12: custom roles for RJCorp users — a named bundle of privileges that
-- rjcorp_admin defines and assigns to rjcorp_user accounts. Base roles still drive
-- data scope; this layer fine-tunes which web-console actions a user may perform.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(80) NOT NULL UNIQUE,
  privileges  TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_custom_role ON users(custom_role_id);
