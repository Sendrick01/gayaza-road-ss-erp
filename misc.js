// routes/misc.js
// Dashboard stats, school settings, audit log, notification history, and the
// parent-facing endpoint - grouped here since each is small and they all
// read from the same single database rather than owning separate state.
const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../utils/audit');
const router = express.Router();

function balanceOf(inv) { return inv ? Math.max(0, inv.amount - inv.paid) : 0; }

// ---------------- Dashboard (role-aware) ----------------
router.get('/dashboard', requireAuth, (req, res) => {
  const role = req.user.role;
  const today = new Date().toISOString().slice(0, 10);

  if (role === 'admin' || role === 'bursar') {
    const activeStudents = db.prepare("SELECT COUNT(*) c FROM students WHERE status='Active'").get().c;
    const invoices = db.prepare('SELECT amount, paid FROM invoices').all();
    const collected = invoices.reduce((s, r) => s + r.paid, 0);
    const outstanding = invoices.reduce((s, r) => s + Math.max(0, r.amount - r.paid), 0);
    const attToday = db.prepare('SELECT status FROM attendance WHERE date = ?').all(today);
    const present = attToday.filter(a => a.status === 'Present').length;
    return res.json({
      role, activeStudents, collected, outstanding,
      defaulters: invoices.filter(r => r.amount - r.paid > 0).length,
      attendanceToday: { total: attToday.length, present, absent: attToday.filter(a => a.status === 'Absent').length }
    });
  }

  if (role === 'teacher') {
    const myClass = 'S.3'; // demo: this teacher owns S.3; a real deployment would store class_teacher_of on the user
    const classSize = db.prepare("SELECT COUNT(*) c FROM students WHERE cls = ? AND status='Active'").get(myClass).c;
    const attToday = db.prepare('SELECT status FROM attendance WHERE date = ? AND cls = ?').all(today, myClass);
    return res.json({ role, myClass, classSize, attendanceToday: { total: attToday.length, present: attToday.filter(a => a.status === 'Present').length, absent: attToday.filter(a => a.status === 'Absent').length } });
  }

  if (role === 'parent') {
    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const student = me.linked_student_id ? db.prepare('SELECT * FROM students WHERE id = ?').get(me.linked_student_id) : null;
    const inv = student ? db.prepare('SELECT * FROM invoices WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(student.id) : null;
    const attendance = student ? db.prepare('SELECT status FROM attendance WHERE student_id = ?').all(student.id) : [];
    return res.json({
      role, student,
      balance: balanceOf(inv),
      attendance: { total: attendance.length, present: attendance.filter(a => a.status === 'Present').length }
    });
  }

  res.json({ role });
});

// ---------------- Settings ----------------
router.get('/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json(settings);
});

router.put('/settings', requireAuth, requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const txn = db.transaction(() => {
    for (const [k, v] of Object.entries(body)) {
      if (k === 'adminEmail') continue; // admin notification email is fixed via .env, not editable in-app, to avoid accidental hijack
      upsert.run(k, String(v));
    }
  });
  txn();
  logAction(req, 'Settings updated', `School setup fields updated: ${Object.keys(body).join(', ')}`);
  res.json({ ok: true });
});

// ---------------- Audit log (admin only - this is the anti-fraud / accountability layer) ----------------
router.get('/audit', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').all();
  res.json(rows);
});

// ---------------- Notification history (admin only) ----------------
router.get('/notifications', requireAuth, requireRole('admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

// ---------------- Parent portal ----------------
router.get('/parent/me', requireAuth, requireRole('parent'), (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!me.linked_student_id) return res.status(404).json({ error: 'No student linked to this account yet. Ask the school office to link it.' });
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(me.linked_student_id);
  const invoice = db.prepare('SELECT * FROM invoices WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(student.id);
  const payments = db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY id DESC').all(student.id);
  const attendance = db.prepare('SELECT * FROM attendance WHERE student_id = ? ORDER BY date DESC LIMIT 30').all(student.id);
  res.json({ student, invoice: invoice ? { ...invoice, balance: balanceOf(invoice) } : null, payments, attendance });
});

module.exports = router;
