-- Dev seed data
-- Passwords are bcrypt of "password123"
-- $2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

INSERT INTO users (name, email, password_hash, role) VALUES
  ('Alice Employee', 'alice@test.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'employee'),
  ('Bob Supervisor', 'bob@test.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'supervisor')
ON CONFLICT (email) DO NOTHING;

INSERT INTO stores (name, address, pincode, lat, long) VALUES
  ('Store Alpha', '12 MG Road, Mumbai', '400001', 19.0760, 72.8777),
  ('Store Beta', '45 Park Street, Kolkata', '700016', 22.5726, 88.3639),
  ('Store Gamma', '7 Brigade Road, Bengaluru', '560025', 12.9716, 77.5946)
ON CONFLICT DO NOTHING;

INSERT INTO brands (name) VALUES
  ('BrandX'),
  ('BrandY'),
  ('BrandZ')
ON CONFLICT DO NOTHING;

INSERT INTO standard_boarding_sizes (label, width_cm, height_cm) VALUES
  ('Small (2x1.5 ft)', 61, 46),
  ('Medium (4x3 ft)', 122, 91),
  ('Large (6x4 ft)', 183, 122),
  ('XL (8x4 ft)', 244, 122)
ON CONFLICT DO NOTHING;

-- Assign all stores to Alice
INSERT INTO store_assignments (store_id, employee_id)
SELECT s.id, u.id FROM stores s CROSS JOIN users u WHERE u.email = 'alice@test.com'
ON CONFLICT DO NOTHING;
