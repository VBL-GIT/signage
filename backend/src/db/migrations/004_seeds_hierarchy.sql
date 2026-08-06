-- Sprint 2 seed data (run AFTER 003_hierarchy.sql)
-- Passwords are bcrypt of "password123":
-- $2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

-- Demo vendor org
INSERT INTO vendors (uid, name, contact_email) VALUES
  ('VBL-VENDOR-001', 'Acme Signage Co', 'acme@vendor.com')
ON CONFLICT (uid) DO NOTHING;

-- RJCorp admin (top-tier)
INSERT INTO users (name, first_name, last_name, email, password_hash, role) VALUES
  ('Raj Admin', 'Raj', 'Admin', 'rjadmin@test.com',
   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'rjcorp_admin')
ON CONFLICT (email) DO NOTHING;

-- Link Alice (employee) and Bob (now vendor_admin) to the demo vendor
UPDATE users
SET vendor_id = (SELECT id FROM vendors WHERE uid = 'VBL-VENDOR-001')
WHERE email IN ('alice@test.com', 'bob@test.com');

-- Ensure first/last names on the legacy demo users
UPDATE users SET first_name = 'Alice', last_name = 'Employee' WHERE email = 'alice@test.com';
UPDATE users SET first_name = 'Bob',   last_name = 'Admin'    WHERE email = 'bob@test.com';
