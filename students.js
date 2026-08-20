// routes/students.js
const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const { notifyAdmin } = require('../utils/mailer');
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
// transaction, so the two records can never drift apart.
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { name, gender, dob, cls, stream, boarding, guardian_name, guardian_phone, guardian_email } = req.body || {};
  if (!name || !cls || !guardian_name || !guardian_phone) {
    return res.status(400).json({ error: 'name, cls, guardian_name and guardian_phone are required.' });
  }
  const feeRow = db.prepare('SELECT amount FROM fee_structures WHERE cls = ?').get(cls);
  if (!feeRow) return res.status(400).json({ error: `No fee structure configured for class "${cls}". Set it in Settings first.` });

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

    return { studentId, admNo };
  });

  const { studentId, admNo } = txn();
  logAction(req, 'Admission', `Admitted ${name} (${admNo}) to ${cls}${stream ? ' ' + stream : ''}; auto-generated ${term} invoice of UGX ${feeRow.amount.toLocaleString()}`);
  notifyAdmin(
    'New student admitted - Gayaza Road SS',
    `${req.user.name} (${req.user.role}) admitted a new student.\n\nName: ${name}\nAdmission No: ${admNo}\nClass: ${cls} ${stream || ''}\nGuardian: ${guardian_name} (${guardian_phone})\nTerm invoice generated: UGX ${feeRow.amount.toLocaleString()}\n\nThis is an automated notification.`
  ).catch(() => {});

  res.status(201).json({ id: studentId, admNo });
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
