// db/seed.js
// Run once with: npm run seed
// Creates the initial users with REAL bcrypt password hashes (never plain
// text, not even in this seed file - the hash is generated at run time).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');

function upsertUser({ username, password, role, name, email, linked_student_id = null }) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  const hash = bcrypt.hashSync(password, 12); // 12 salt rounds - real cost factor, not a toy
  if (existing) {
    db.prepare('UPDATE users SET password_hash=?, role=?, name=?, email=?, linked_student_id=? WHERE username=?')
      .run(hash, role, name, email, linked_student_id, username);
  } else {
    db.prepare('INSERT INTO users (username, password_hash, role, name, email, linked_student_id) VALUES (?,?,?,?,?,?)')
      .run(username, hash, role, name, email, linked_student_id);
  }
}

function seedDatabase() {
const seedTxn = db.transaction(() => {
  // ---- School settings ----
  const settingsDefaults = {
    schoolName: 'Gayaza Road Secondary School',
    location: 'Kyebando, Gayaza Road, Kampala, Uganda',
    term: 'Term 2',
    year: '2026',
    adminEmail: process.env.ADMIN_EMAIL || 'ssekitened@gmail.com'
  };
  for (const [key, value] of Object.entries(settingsDefaults)) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value);
  }

  // ---- Fee structures (per class, per term, in UGX) ----
  const fees = { 'S.1': 650000, 'S.2': 650000, 'S.3': 700000, 'S.4': 750000, 'S.5': 900000, 'S.6': 900000 };
  for (const [cls, amount] of Object.entries(fees)) {
    db.prepare('INSERT INTO fee_structures (cls, amount) VALUES (?, ?) ON CONFLICT(cls) DO UPDATE SET amount=excluded.amount')
      .run(cls, amount);
  }

  // ---- Seed students (only if table empty, so re-running seed is safe) ----
  const studentCount = db.prepare('SELECT COUNT(*) c FROM students').get().c;
  if (studentCount === 0) {
    const insertStudent = db.prepare(`
      INSERT INTO students (adm_no, name, gender, dob, cls, stream, boarding, status, guardian_name, guardian_phone, guardian_email)
      VALUES (@adm_no,@name,@gender,@dob,@cls,@stream,@boarding,'Active',@guardian_name,@guardian_phone,@guardian_email)
    `);
    const insertInvoice = db.prepare(`
      INSERT INTO invoices (student_id, term, amount, paid) VALUES (?,?,?,?)
    `);

    const students = [
      { adm_no: 'GRSS/2026/0001', name: 'Nakato Aisha', gender: 'Female', dob: '2011-03-14', cls: 'S.3', stream: 'A', boarding: 'Day', guardian_name: 'Robert Ssemwogerere', guardian_phone: '0772000001', guardian_email: null, paidFraction: 1 },
      { adm_no: 'GRSS/2026/0002', name: 'Kato Brian', gender: 'Male', dob: '2010-11-02', cls: 'S.3', stream: 'A', boarding: 'Boarding', guardian_name: 'Christine Nabirye', guardian_phone: '0772000002', guardian_email: null, paidFraction: 0.4 },
      { adm_no: 'GRSS/2026/0003', name: 'Namutebi Faith', gender: 'Female', dob: '2012-06-21', cls: 'S.2', stream: 'B', boarding: 'Day', guardian_name: 'John Mukasa', guardian_phone: '0772000003', guardian_email: null, paidFraction: 0 },
      { adm_no: 'GRSS/2026/0004', name: 'Okwir David', gender: 'Male', dob: '2009-01-09', cls: 'S.4', stream: 'A', boarding: 'Boarding', guardian_name: 'Betty Okwir', guardian_phone: '0772000004', guardian_email: null, paidFraction: 0 }
    ];

    for (const s of students) {
      const info = insertStudent.run(s);
      const studentId = info.lastInsertRowid;
      const amount = fees[s.cls];
      insertInvoice.run(studentId, `${settingsDefaults.term} ${settingsDefaults.year}`, amount, Math.round(amount * s.paidFraction));
    }
  }

  // ---- Users / accounts ----
  // IMPORTANT: change these passwords immediately after first login in a
  // real deployment. They exist so you can log in and test the system.
  const nakato = db.prepare('SELECT id FROM students WHERE adm_no = ?').get('GRSS/2026/0001');

  upsertUser({ username: 'admin', password: 'Admin@2026!', role: 'admin', name: 'Sarah Nakabuye (Head Teacher)', email: process.env.ADMIN_EMAIL || 'ssekitened@gmail.com' });
  upsertUser({ username: 'bursar', password: 'Bursar@2026!', role: 'bursar', name: 'Moses Okello (Bursar)', email: null });
  upsertUser({ username: 'teacher', password: 'Teacher@2026!', role: 'teacher', name: 'Grace Amuge (Class Teacher, S.3)', email: null });
  upsertUser({ username: 'parent', password: 'Parent@2026!', role: 'parent', name: 'Robert Ssemwogerere', email: null, linked_student_id: nakato ? nakato.id : null });

  db.prepare('INSERT INTO audit_log (user_id, username, role, action, detail) VALUES (NULL, ?, ?, ?, ?)')
    .run('system', 'system', 'Seed', 'Database seeded with initial users, students, invoices and fee structures');
});

seedTxn();
console.log('Seed complete.');
console.log('Database file:', process.env.DB_PATH || './school.db');
console.log('');
console.log('Demo logins (CHANGE THESE PASSWORDS after first login):');
console.log('  admin   / Admin@2026!');
console.log('  bursar  / Bursar@2026!');
console.log('  teacher / Teacher@2026!');
console.log('  parent  / Parent@2026!');
}

module.exports = { seedDatabase };

// Only auto-run immediately when this file is executed directly via
// `npm run seed` / `node db/seed.js`. When server.js instead *requires*
// this file to auto-seed an empty database on first boot (e.g. on Render,
// where there's no separate shell step), it calls seedDatabase() itself
// and this block is skipped.
if (require.main === module) {
  seedDatabase();
}
