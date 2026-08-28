// routes/misc.js
// Dashboard stats, school settings, audit log, notification history, and the
// parent-facing endpoint - grouped here since each is small and they all
// read from the same single database rather than owning separate state.
const express = require('express');
const db = require('./database');
const { requireAuth, requireRole } = require('./auth-middleware');
const { logAction } = require('./audit');
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
    const children = db.prepare(`
      SELECT s.id, s.name, s.adm_no, s.cls FROM students s
      JOIN parent_students ps ON ps.student_id = s.id
      WHERE ps.user_id = ?
    `).all(req.user.id);

    let totalBalance = 0, attTotal = 0, attPresent = 0;
    for (const c of children) {
      const inv = db.prepare('SELECT * FROM invoices WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
      totalBalance += balanceOf(inv);
      const att = db.prepare('SELECT status FROM attendance WHERE student_id = ?').all(c.id);
      attTotal += att.length;
      attPresent += att.filter(a => a.status === 'Present').length;
    }
    return res.json({
      role, childrenCount: children.length,
      childrenNames: children.map(c => c.name),
      balance: totalBalance,
      attendance: { total: attTotal, present: attPresent }
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
// A guardian account can be linked to several children (siblings at the
// same school) via the parent_students join table, so the API is split
// in two: a lightweight list of children, then per-child detail fetched
// only once the parent picks one. Every access is checked server-side
// against parent_students - a parent can never fetch a child that isn't
// actually linked to their account, no matter what id they try in the URL.
router.get('/parent/children', requireAuth, requireRole('parent'), (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.adm_no, s.name, s.cls, s.stream, s.status
    FROM students s
    JOIN parent_students ps ON ps.student_id = s.id
    WHERE ps.user_id = ?
    ORDER BY s.name
  `).all(req.user.id);

  const withBalance = rows.map(s => {
    const inv = db.prepare('SELECT * FROM invoices WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(s.id);
    return { ...s, balance: balanceOf(inv) };
  });

  if (withBalance.length === 0) {
    return res.status(404).json({ error: 'No student is linked to this account yet. Ask the school office to link one.' });
  }
  res.json(withBalance);
});

router.get('/parent/student/:id', requireAuth, requireRole('parent'), (req, res) => {
  const studentId = Number(req.params.id);
  const link = db.prepare('SELECT 1 FROM parent_students WHERE user_id = ? AND student_id = ?').get(req.user.id, studentId);
  if (!link) return res.status(403).json({ error: 'This student is not linked to your account.' });

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  const invoice = db.prepare('SELECT * FROM invoices WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(studentId);
  const payments = db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY id DESC').all(studentId);
  const attendance = db.prepare('SELECT * FROM attendance WHERE student_id = ? ORDER BY date DESC LIMIT 30').all(studentId);
  res.json({ student, invoice: invoice ? { ...invoice, balance: balanceOf(invoice) } : null, payments, attendance });
});

module.exports = router;
