CREATE TABLE IF NOT EXISTS lid_mappings (
  lid VARCHAR(100) PRIMARY KEY,
  phone VARCHAR(50) NOT NULL,
  full_name VARCHAR(200),
  first_name VARCHAR(200),
  business_name VARCHAR(200),
  push_name VARCHAR(200),
  is_my_contact BOOLEAN DEFAULT false,
  is_business BOOLEAN DEFAULT false,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lid_mappings_phone ON lid_mappings(phone);

CREATE TABLE IF NOT EXISTS pending_lid_contacts (
  lid VARCHAR(100) PRIMARY KEY,
  chat_id VARCHAR(50),
  full_name TEXT,
  first_name TEXT,
  push_name TEXT,
  business_name TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);
