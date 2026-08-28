// db/database.js
// ---------------------------------------------------------------------------
// THE single database for the whole school. Every route in this app opens
// this same file - there is no per-module storage, no duplicated student
// records, nothing living only in the browser. This is what "one connected
// database" actually means in practice.
// ---------------------------------------------------------------------------
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'school.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','bursar','teacher','parent')),
  name TEXT NOT NULL,
  email TEXT,
  linked_student_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(linked_student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adm_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  gender TEXT NOT NULL,
  dob TEXT,
  cls TEXT NOT NULL,
  stream TEXT,
  boarding TEXT DEFAULT 'Day',
  status TEXT DEFAULT 'Active',
  guardian_name TEXT NOT NULL,
  guardian_phone TEXT NOT NULL,
  guardian_email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fee_structures (
  cls TEXT PRIMARY KEY,
  amount INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  term TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,
  receipt_no TEXT UNIQUE NOT NULL,
  recorded_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(invoice_id) REFERENCES invoices(id),
  FOREIGN KEY(student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  cls TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Present','Absent','Late','Excused')),
  recorded_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(student_id, date),
  FOREIGN KEY(student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT NOT NULL,
  role TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Many-to-many: one guardian account can be linked to several children
-- (very common in Uganda - siblings at the same school), and in principle
-- a student could have more than one portal-linked guardian too.
CREATE TABLE IF NOT EXISTS parent_students (
  user_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, student_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(student_id) REFERENCES students(id)
);
`);

module.exports = db;
