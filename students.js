// routes/students.js
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { requireAuth, requireRole } = require('./auth-middleware');
const { logAction } = require('./audit');
const { notifyAdmin } = require('./mailer');
const router = express.Router();

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

router.get('/', requireAuth, requireRole('admin', 'bursar', 'teacher'), (req, res) => {
  const { q, cls } = req.query;
  let sql = 'SELECT * FROM students WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR adm_no LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (cls) { sql += ' AND cls = ?'; params.push(cls); }
  sql += ' ORDER BY id DESC';
  const students = db.prepare(sql).all(...params);

  // attach live invoice/balance so the frontend never has to stitch two calls together
  const withInvoices = students.map(s => {
    const inv = db.prepare('SELECT * FROM invoices WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(s.id);
    return { ...s, invoice: inv || null, balance: inv ? inv.amount - inv.paid : 0 };
  });
  res.json(withInvoices);
});

router.get('/:id', requireAuth, requireRole('admin', 'bursar', 'teacher'), (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  res.json(student);
});

// Admin only: admission auto-generates adm_no AND the term invoice in one
// transaction, so the two records can never drift apart. Optionally also
// creates (or links to an existing) parent portal account in the same
// transaction - this is the real-world fix: without this, admin staff
// have to remember to separately go create a parent login afterwards,
// and in practice that step gets skipped for most students.
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const {
    name, gender, dob, cls, stream, boarding, guardian_name, guardian_phone, guardian_email,
    create_parent_account, parent_username, parent_password
  } = req.body || {};

  if (!name || !cls || !guardian_name || !guardian_phone) {
    return res.status(400).json({ error: 'name, cls, guardian_name and guardian_phone are required.' });
  }
  const feeRow = db.prepare('SELECT amount FROM fee_structures WHERE cls = ?').get(cls);
  if (!feeRow) return res.status(400).json({ error: `No fee structure configured for class "${cls}". Set it in Settings first.` });

  if (create_parent_account) {
    if (!parent_username || !parent_password) {
      return res.status(400).json({ error: 'Parent username and password are required to create a parent login.' });
    }
    if (parent_password.length < 8) {
      return res.status(400).json({ error: 'Parent password must be at least 8 characters.' });
    }
  }

  const year = getSetting('year') || new Date().getFullYear().toString();
  const term = `${getSetting('term') || 'Term 1'} ${year}`;

  const txn = db.transaction(() => {
    const countThisYear = db.prepare(`SELECT COUNT(*) c FROM students WHERE adm_no LIKE ?`).get(`GRSS/${year}/%`).c;
    const admNo = `GRSS/${year}/${String(countThisYear + 1).padStart(4, '0')}`;

    const info = db.prepare(`
      INSERT INTO students (adm_no, name, gender, dob, cls, stream, boarding, status, guardian_name, guardian_phone, guardian_email)
      VALUES (?,?,?,?,?,?,?, 'Active', ?,?,?)
    `).run(admNo, name, gender || 'Female', dob || null, cls, stream || 'A', boarding || 'Day', guardian_name, guardian_phone, guardian_email || null);

    const studentId = info.lastInsertRowid;
    db.prepare('INSERT INTO invoices (student_id, term, amount, paid) VALUES (?,?,?,0)')
      .run(studentId, term, feeRow.amount);

    let parentAccountInfo = null;
    if (create_parent_account) {
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(parent_username);
      if (existing) {
        // Same guardian already has a login (e.g. admitting a sibling) -
        // just link this new child to their existing account rather than
        // erroring out or creating a duplicate.
        db.prepare('INSERT OR IGNORE INTO parent_students (user_id, student_id) VALUES (?, ?)').run(existing.id, studentId);
        parentAccountInfo = { username: parent_username, isNewAccount: false };
      } else {
        const hash = bcrypt.hashSync(parent_password, 12);
        const userInfo = db.prepare('INSERT INTO users (username, password_hash, role, name, email) VALUES (?,?,\'parent\',?,?)')
          .run(parent_username, hash, guardian_name, guardian_email || null);
        db.prepare('INSERT INTO parent_students (user_id, student_id) VALUES (?, ?)').run(userInfo.lastInsertRowid, studentId);
        parentAccountInfo = { username: parent_username, isNewAccount: true };
      }
    }

    return { studentId, admNo, parentAccountInfo };
  });

  const { studentId, admNo, parentAccountInfo } = txn();
  logAction(req, 'Admission', `Admitted ${name} (${admNo}) to ${cls}${stream ? ' ' + stream : ''}; auto-generated ${term} invoice of UGX ${feeRow.amount.toLocaleString()}${parentAccountInfo ? (parentAccountInfo.isNewAccount ? `; created parent login "${parentAccountInfo.username}"` : `; linked to existing parent login "${parentAccountInfo.username}"`) : ''}`);
  notifyAdmin(
    'New student admitted - Gayaza Road SS',
    `${req.user.name} (${req.user.role}) admitted a new student.\n\nName: ${name}\nAdmission No: ${admNo}\nClass: ${cls} ${stream || ''}\nGuardian: ${guardian_name} (${guardian_phone})\nTerm invoice generated: UGX ${feeRow.amount.toLocaleString()}${parentAccountInfo ? `\nParent portal login: ${parentAccountInfo.username} (${parentAccountInfo.isNewAccount ? 'new account' : 'linked to existing account'})` : ''}\n\nThis is an automated notification.`
  ).catch(() => {});

  res.status(201).json({ id: studentId, admNo, parentAccount: parentAccountInfo });
});

router.patch('/:id/status', requireAuth, requireRole('admin'), (req, res) => {
  const { status } = req.body || {};
  if (!['Active', 'Withdrawn', 'Suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  db.prepare('UPDATE students SET status = ? WHERE id = ?').run(status, req.params.id);
  logAction(req, 'Student status changed', `${student.name} (${student.adm_no}) set to ${status}`);
  res.json({ ok: true });
});

module.exports = router;
