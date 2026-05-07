// Database schema for car service shop work orders

export const createTablesSQL = `
-- Mechanics table
CREATE TABLE IF NOT EXISTS mechanics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ime TEXT NOT NULL,
  prezime TEXT NOT NULL,
  telefon TEXT,
  aktivan INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Customers table (reusable profiles)
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naziv_firme TEXT,
  ime TEXT NOT NULL,
  prezime TEXT NOT NULL,
  telefon TEXT,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Vehicles table (connected to customers)
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  registarske_tablice TEXT NOT NULL,
  vin_broj TEXT,
  marka_vozila TEXT NOT NULL,
  model_vozila TEXT NOT NULL,
  motor TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Work Orders table
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broj_naloga TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL,
  tip_naloga TEXT NOT NULL DEFAULT 'auto',
  registarske_tablice TEXT NOT NULL,
  vin_broj TEXT,
  marka_vozila TEXT NOT NULL,
  model_vozila TEXT NOT NULL,
  motor TEXT,
  kilometraza INTEGER,
  tip_agregata TEXT,
  marka_agregata TEXT,
  model_agregata TEXT,
  serijski_broj TEXT,
  mechanic_id INTEGER,
  opis_kvara TEXT,
  napomena TEXT,
  status TEXT DEFAULT 'otvoren',
  ukupna_cijena REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (mechanic_id) REFERENCES mechanics(id)
);

-- Work Order Items table (parts and services)
CREATE TABLE IF NOT EXISTS work_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  tip TEXT NOT NULL,
  naziv TEXT NOT NULL,
  kolicina REAL DEFAULT 1,
  jedinicna_cijena REAL NOT NULL,
  popust REAL DEFAULT 0,
  ukupna_cijena REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
);

-- Time entries table (for tracking work sessions)
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  mechanic_id INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (mechanic_id) REFERENCES mechanics(id)
);

-- Users table (for authentication)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'mechanic',
  mechanic_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (mechanic_id) REFERENCES mechanics(id)
);

-- Sessions table (for auth sessions)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for search optimization
CREATE INDEX IF NOT EXISTS idx_time_entries_work_order ON time_entries(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_vin ON work_orders(vin_broj);
CREATE INDEX IF NOT EXISTS idx_work_orders_plates ON work_orders(registarske_tablice);
CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON work_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_created ON work_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_work_order_items_type ON work_order_items(tip);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(ime, prezime);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`;
