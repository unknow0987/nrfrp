-- ═══════════════════════════════════════════════════════════
-- NRFRP Complete Database Schema
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_hash VARCHAR(64) UNIQUE NOT NULL,
  email VARCHAR(255),
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','donor','needy','volunteer')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','blacklisted')),
  mfa_secret VARCHAR(255),
  failed_login_attempts INT DEFAULT 0,
  last_login_ip INET,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE donors (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('individual','organisation')),
  display_name VARCHAR(255),
  pan_hash VARCHAR(64),
  aadhaar_hash VARCHAR(64),
  org_name VARCHAR(255),
  gst_number VARCHAR(20),
  cin VARCHAR(21),
  is_anonymous BOOLEAN DEFAULT false,
  total_donated DECIMAL(14,2) DEFAULT 0,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id)
);

CREATE TABLE needy_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('individual_general','individual_medical','individual_emergency','organisation')),
  urgency VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (urgency IN ('critical','high','normal')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','step2','step3','step4','step5','verified','active','closed','expired')),
  help_types TEXT[] DEFAULT '{}',
  family_size INT DEFAULT 1,
  description TEXT,
  lat DECIMAL(10,8),
  lng DECIMAL(11,8),
  district VARCHAR(100),
  state VARCHAR(100),
  aadhaar_hash VARCHAR(64),
  id_doc_s3_key VARCHAR(500),
  evidence_s3_keys TEXT[] DEFAULT '{}',
  volunteer_report_s3 VARCHAR(500),
  geo_mismatch BOOLEAN DEFAULT false,
  fraud_flags TEXT[] DEFAULT '{}',
  assigned_volunteer UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE volunteers (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(255),
  skills TEXT[] DEFAULT '{}',
  tier VARCHAR(20) DEFAULT 'field' CHECK (tier IN ('field','coordinator','area_coordinator')),
  service_radius INT DEFAULT 10,
  home_lat DECIMAL(10,8),
  home_lng DECIMAL(11,8),
  vehicle_type VARCHAR(50),
  vehicle_capacity INT,
  rating DECIMAL(3,2) DEFAULT 0,
  rating_count INT DEFAULT 0,
  tasks_completed INT DEFAULT 0,
  is_champion BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT false,
  approved_at TIMESTAMPTZ
);

CREATE TABLE drives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('food','medical','clothing','shelter','skill_camp','disaster')),
  description TEXT,
  area VARCHAR(255),
  radius_km INT DEFAULT 20,
  fund_target DECIMAL(12,2) DEFAULT 0,
  fund_collected DECIMAL(12,2) DEFAULT 0,
  volunteer_slots INT DEFAULT 0,
  volunteers_assigned INT DEFAULT 0,
  beneficiaries_count INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('draft','active','completed','closed')),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  impact_report_s3 VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE donations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  donor_id UUID REFERENCES users(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('money','food','medicines','clothes','accommodation','transport','equipment','skill')),
  amount DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'INR',
  quantity INT,
  unit VARCHAR(50),
  description TEXT,
  case_id UUID REFERENCES needy_cases(id),
  drive_id UUID REFERENCES drives(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','collected','in_transit','delivered','used','refunded')),
  is_anonymous BOOLEAN DEFAULT false,
  is_recurring BOOLEAN DEFAULT false,
  recurring_day INT CHECK (recurring_day BETWEEN 1 AND 28),
  razorpay_order_id VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  bill_s3_key VARCHAR(500),
  proof_photos TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  drive_id UUID REFERENCES drives(id),
  case_id UUID REFERENCES needy_cases(id),
  donation_id UUID REFERENCES donations(id),
  volunteer_id UUID REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  description TEXT,
  pickup_address TEXT,
  delivery_address TEXT,
  pickup_lat DECIMAL(10,8),
  pickup_lng DECIMAL(11,8),
  delivery_lat DECIMAL(10,8),
  delivery_lng DECIMAL(11,8),
  status VARCHAR(20) DEFAULT 'created' CHECK (status IN ('created','notified','accepted','declined','in_progress','proof_uploaded','verified','completed')),
  priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('critical','high','normal','low')),
  assigned_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  deadline TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  proof_photo_s3 VARCHAR(500),
  proof_lat DECIMAL(10,8),
  proof_lng DECIMAL(11,8),
  volunteer_notes TEXT,
  admin_rating INT CHECK (admin_rating BETWEEN 1 AND 5),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE fund_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  drive_id UUID REFERENCES drives(id),
  case_id UUID REFERENCES needy_cases(id),
  donation_id UUID REFERENCES donations(id),
  amount DECIMAL(12,2) NOT NULL,
  description TEXT,
  category VARCHAR(30) CHECK (category IN ('food','medicine','transport','shelter','clothes','equipment','other')),
  vendor_name VARCHAR(255),
  vendor_contact VARCHAR(100),
  bill_s3_key VARCHAR(500),
  proof_photos TEXT[] DEFAULT '{}',
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  urgency_level VARCHAR(10) DEFAULT 'active' CHECK (urgency_level IN ('urgent','active','completed')),
  drive_id UUID REFERENCES drives(id),
  case_id UUID REFERENCES needy_cases(id),
  fund_target DECIMAL(12,2) DEFAULT 0,
  fund_raised DECIMAL(12,2) DEFAULT 0,
  area VARCHAR(255),
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  before_state JSONB,
  after_state JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE otp_store (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_hash VARCHAR(64) NOT NULL,
  otp_hash VARCHAR(64) NOT NULL,
  purpose VARCHAR(30) DEFAULT 'login',
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_users_phone ON users(phone_hash);
CREATE INDEX idx_users_role_status ON users(role, status);
CREATE INDEX idx_needy_status ON needy_cases(status, urgency);
CREATE INDEX idx_donations_donor ON donations(donor_id);
CREATE INDEX idx_tasks_volunteer ON tasks(volunteer_id, status);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_fund_tx_drive ON fund_transactions(drive_id);
CREATE INDEX idx_notices_published ON notices(is_published, urgency_level);
CREATE INDEX idx_drives_status ON drives(status, type);

-- Platform stats view
CREATE VIEW platform_stats AS
SELECT
  COALESCE((SELECT SUM(amount) FROM donations WHERE type='money' AND status != 'refunded'),0) as total_donated,
  COALESCE((SELECT SUM(amount) FROM fund_transactions WHERE is_verified=true),0) as total_disbursed,
  (SELECT COUNT(*) FROM needy_cases WHERE status='active') as active_cases,
  (SELECT COUNT(*) FROM needy_cases WHERE status='pending') as pending_cases,
  (SELECT COUNT(*) FROM volunteers v JOIN users u ON v.id=u.id WHERE u.status='active') as active_volunteers,
  (SELECT COUNT(*) FROM drives WHERE status='active') as active_drives,
  (SELECT COUNT(*) FROM drives WHERE status='completed') as drives_completed,
  COALESCE((SELECT SUM(beneficiaries_count) FROM drives WHERE status IN ('completed','active')),0) as people_helped,
  COALESCE((SELECT SUM(CASE WHEN type='food' THEN quantity ELSE 0 END) FROM donations WHERE status IN ('delivered','used')),0) as meals_served;

-- Seed admin user
INSERT INTO users (id, phone_hash, email, role, status)
VALUES ('a0000000-0000-0000-0000-000000000001', encode(digest('+910000000000','sha256'),'hex'), 'admin@nrfrp.org', 'admin', 'active')
ON CONFLICT DO NOTHING;

-- Seed drives
INSERT INTO drives (id, name, type, description, area, fund_target, fund_collected, status, start_date, end_date, beneficiaries_count, volunteers_assigned, created_by) VALUES
('d0000000-0000-0000-0000-000000000001','Winter Clothes Drive — Delhi NCR','clothing','Collecting warm clothes for 200+ homeless families. Drop points at 4 locations.','Delhi NCR',150000,94500,'active',NOW()-INTERVAL '5 days',NOW()+INTERVAL '10 days',120,8,'a0000000-0000-0000-0000-000000000001'),
('d0000000-0000-0000-0000-000000000002','TB Medicine Fund — Dharavi','medical','12 verified patients cannot afford 3-month medicine course. Volunteer doctor assigned.','Dharavi, Mumbai',36000,14400,'active',NOW()-INTERVAL '2 days',NOW()+INTERVAL '20 days',12,1,'a0000000-0000-0000-0000-000000000001'),
('d0000000-0000-0000-0000-000000000003','Flood Relief — Assam Oct 2024','disaster','1,200 families reached. Full expense report available.','Assam',230000,230000,'completed',NOW()-INTERVAL '60 days',NOW()-INTERVAL '10 days',1200,0,'a0000000-0000-0000-0000-000000000001'),
('d0000000-0000-0000-0000-000000000004','Food Drive — Noida Dec','food','Daily meals for 400 families across Noida sector 18, 22, 44.','Noida',80000,64800,'active',NOW()-INTERVAL '3 days',NOW()+INTERVAL '7 days',400,12,'a0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- Seed notices
INSERT INTO notices (title, description, urgency_level, drive_id, fund_target, fund_raised, area, is_published, published_at, created_by) VALUES
('Medical aid needed — 12 TB patients, Dharavi','12 verified patients cannot afford 3-month medicine course. ₹36,000 needed. Volunteer doctor assigned. Fund target 40% reached.','urgent','d0000000-0000-0000-0000-000000000002',36000,14400,'Mumbai',true,NOW()-INTERVAL '2 days','a0000000-0000-0000-0000-000000000001'),
('Winter clothes drive — Delhi NCR, 15–30 Dec','Collecting warm clothes for 200+ homeless families. Drop points: 4 locations. 63% of target collected. 8 volunteers deployed.','active','d0000000-0000-0000-0000-000000000001',150000,94500,'Delhi NCR',true,NOW()-INTERVAL '5 days','a0000000-0000-0000-0000-000000000001'),
('Flood relief — Assam, Oct 2024','1,200 families reached. ₹2.3L spent. Full expense report + photos available.','completed','d0000000-0000-0000-0000-000000000003',230000,230000,'Assam',true,NOW()-INTERVAL '60 days','a0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- Seed fund transactions
INSERT INTO fund_transactions (amount, description, category, vendor_name, is_verified, verified_by, verified_at, drive_id) VALUES
(12400,'Groceries, Dal Rice — 400 servings','food','Local Mandi Noida',true,'a0000000-0000-0000-0000-000000000001',NOW()-INTERVAL '1 day','d0000000-0000-0000-0000-000000000004'),
(8750,'Antibiotics · 8 patients · Chemist Sanjay Medical','medicine','Sanjay Medical Store',true,'a0000000-0000-0000-0000-000000000001',NOW()-INTERVAL '6 days','d0000000-0000-0000-0000-000000000002'),
(2100,'3 patient hospital trips, Gurgaon AIIMS','transport','Volunteer driver',true,'a0000000-0000-0000-0000-000000000001',NOW()-INTERVAL '11 days','d0000000-0000-0000-0000-000000000002'),
(45000,'Flood relief supplies — tarpaulin, food, medicine','food','Assam Relief Stores',true,'a0000000-0000-0000-0000-000000000001',NOW()-INTERVAL '20 days','d0000000-0000-0000-0000-000000000003'),
(18000,'Warm jackets — 60 units','clothes','Wholesale Cloth Market Delhi',true,'a0000000-0000-0000-0000-000000000001',NOW()-INTERVAL '3 days','d0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;
