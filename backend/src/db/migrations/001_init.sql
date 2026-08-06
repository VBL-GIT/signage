-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Vendors (empty in v1, used in future for hierarchy)
CREATE TABLE IF NOT EXISTS vendors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  phone         VARCHAR(20),
  password_hash TEXT NOT NULL,
  role          VARCHAR(50) NOT NULL CHECK (role IN ('employee', 'supervisor')),
  vendor_id     UUID REFERENCES vendors(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stores
CREATE TABLE IF NOT EXISTS stores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  address    TEXT NOT NULL,
  pincode    VARCHAR(10) NOT NULL,
  lat        DECIMAL(10, 7) NOT NULL,
  long       DECIMAL(10, 7) NOT NULL,
  vendor_id  UUID REFERENCES vendors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Store assignments (employee ↔ store)
CREATE TABLE IF NOT EXISTS store_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (store_id, employee_id)
);

-- Brands
CREATE TABLE IF NOT EXISTS brands (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  vendor_id  UUID REFERENCES vendors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Standard boarding sizes
CREATE TABLE IF NOT EXISTS standard_boarding_sizes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label     VARCHAR(100) NOT NULL,
  width_cm  INTEGER NOT NULL,
  height_cm INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type     VARCHAR(50) NOT NULL CHECK (task_type IN (
                  'recee_approval_installation',
                  'installation_only',
                  'pamphlet_distribution'
                )),
  status        VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN (
                  'pending',
                  'recee_submitted',
                  'recee_approved',
                  'recee_rejected',
                  'installed',
                  'completed'
                )),
  store_id      UUID REFERENCES stores(id) ON DELETE SET NULL,
  employee_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supervisor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  brand_id      UUID REFERENCES brands(id) ON DELETE SET NULL,
  pincode       VARCHAR(10),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Task steps (append-only audit log)
CREATE TABLE IF NOT EXISTS task_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_type         VARCHAR(50) NOT NULL CHECK (step_type IN (
                      'recee', 'approval', 'installation', 'pamphlet_drop'
                    )),
  performed_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat               DECIMAL(10, 7),
  long              DECIMAL(10, 7),
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  photo_url         TEXT,
  notes             TEXT,
  -- boarding fields
  boarding_size_id  UUID REFERENCES standard_boarding_sizes(id) ON DELETE SET NULL,
  custom_width_cm   INTEGER,
  custom_height_cm  INTEGER,
  -- approval fields
  approval_status   VARCHAR(20) CHECK (approval_status IN ('approved', 'rejected')),
  rejection_reason  TEXT,
  -- pamphlet fields
  pamphlet_count    INTEGER
);

-- Follow-ups (for pamphlet tasks)
CREATE TABLE IF NOT EXISTS follow_ups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  photo_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_employee ON tasks(employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_store_assignments_employee ON store_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
