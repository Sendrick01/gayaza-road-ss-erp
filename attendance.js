// routes/attendance.js
const express = require('express');
const db = require('./database');
const { requireAuth, requireRole } = require('./auth-middleware');
const { logAction } = require('./audit');
const { notifyAdmin } = require('./mailer');
const router = express.Router();

router.get('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { cls, date } = req.query;
  if (!cls || !date) return res.status(400).json({ error: 'cls and date query params are required.' });

  const students = db.prepare('SELECT * FROM students WHERE cls = ? AND status = \'Active\' ORDER BY name').all(cls);
  const existing = db.prepare('SELECT * FROM attendance WHERE cls = ? AND date = ?').all(cls, date);
  const map = new Map(existing.map(a => [a.student_id, a.status]));

  res.json(students.map(s => ({ ...s, attendanceStatus: map.get(s.id) || 'Present' })));
});

// Real address for real-world Ugandan school problem: absent students who
// no one flagged to parents until report card day. Saving the register
// automatically compiles who was absent and emails the admin immediately,
// so it can be forwarded to parents same-day instead of silently logged.
router.post('/', requireAuth, requireRole('admin', 'teacher'), (req, res) => {
  const { cls, date, records } = req.body || {}; // records: [{studentId, status}]
  if (!cls || !date || !Array.isArray(records)) return res.status(400).json({ error: 'cls, date and records[] are required.' });

  const upsert = db.prepare(`
    INSERT INTO attendance (student_id, cls, date, status, recorded_by)
    VALUES (?,?,?,?,?)
    ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, recorded_by = excluded.recorded_by, cls = excluded.cls
  `);
  const txn = db.transaction((recs) => {
    for (const r of recs) upsert.run(r.studentId, cls, date, r.status, req.user.username);
  });
  txn(records);

  const absentees = records.filter(r => r.status === 'Absent');
  logAction(req, 'Attendance saved', `${cls} register for ${date}: ${records.length} students, ${absentees.length} absent.`);

  if (absentees.length > 0) {
    const names = db.prepare(`SELECT id, name, adm_no, guardian_name, guardian_phone FROM students WHERE id IN (${absentees.map(() => '?').join(',')})`)
      .all(...absentees.map(a => a.studentId));
    const lines = names.map(s => `- ${s.name} (${s.adm_no}) — guardian ${s.guardian_name}, ${s.guardian_phone}`).join('\n');
    notifyAdmin(
      `Absentee summary: ${cls} on ${date} - Gayaza Road SS`,
      `${req.user.name} recorded attendance for ${cls} on ${date}.\n\n${absentees.length} student(s) absent:\n${lines}\n\nThis is an automated notification - forward to guardians as needed.`
    ).catch(() => {});
  }

  res.json({ ok: true, absentCount: absentees.length });
});

module.exports = router;
