// reports.js
// Analytics & downloadable reporting. Two endpoints:
//   GET /api/reports/overview  -> JSON summary (school-wide + per-class), used to render the Reports page and the printable view
//   GET /api/reports/csv       -> a real downloadable CSV file, one row per student, for opening in Excel/Sheets or archiving
// Admin only - this is financial + attendance data across every student.
const express = require('express');
const db = require('./database');
const { requireAuth, requireRole } = require('./auth-middleware');
const { logAction } = require('./audit');
const router = express.Router();

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function studentReportRows() {
  return db.prepare(`
    SELECT
      s.id, s.adm_no, s.name, s.gender, s.cls, s.stream, s.status,
      s.guardian_name, s.guardian_phone,
      i.amount AS invoice_amount, i.paid AS invoice_paid,
      (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id) AS att_total,
      (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id AND a.status = 'Present') AS att_present,
      (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id AND a.status = 'Absent') AS att_absent
    FROM students s
    LEFT JOIN invoices i ON i.id = (SELECT MAX(id) FROM invoices WHERE student_id = s.id)
    ORDER BY s.cls, s.name
  `).all();
}

router.get('/overview', requireAuth, requireRole('admin', 'bursar'), (req, res) => {
  const rows = studentReportRows();

  const byClassMap = {};
  for (const r of rows) {
    if (!byClassMap[r.cls]) byClassMap[r.cls] = { cls: r.cls, studentCount: 0, invoiced: 0, collected: 0, attTotal: 0, attPresent: 0 };
    const c = byClassMap[r.cls];
    c.studentCount += 1;
    c.invoiced += r.invoice_amount || 0;
    c.collected += r.invoice_paid || 0;
    c.attTotal += r.att_total || 0;
    c.attPresent += r.att_present || 0;
  }
  const byClass = Object.values(byClassMap).map(c => ({
    cls: c.cls,
    studentCount: c.studentCount,
    invoiced: c.invoiced,
    collected: c.collected,
    outstanding: c.invoiced - c.collected,
    attendanceRatePercent: c.attTotal > 0 ? Math.round((c.attPresent / c.attTotal) * 100) : null
  })).sort((a, b) => a.cls.localeCompare(b.cls));

  const totalInvoiced = rows.reduce((s, r) => s + (r.invoice_amount || 0), 0);
  const totalCollected = rows.reduce((s, r) => s + (r.invoice_paid || 0), 0);
  const attTotalAll = rows.reduce((s, r) => s + (r.att_total || 0), 0);
  const attPresentAll = rows.reduce((s, r) => s + (r.att_present || 0), 0);

  const defaulters = rows
    .map(r => ({ adm_no: r.adm_no, name: r.name, cls: r.cls, guardian_name: r.guardian_name, guardian_phone: r.guardian_phone, balance: (r.invoice_amount || 0) - (r.invoice_paid || 0) }))
    .filter(d => d.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 20);

  res.json({
    generatedAt: new Date().toISOString(),
    schoolName: getSetting('schoolName') || 'Gayaza Road Secondary School',
    term: getSetting('term') || '',
    year: getSetting('year') || '',
    overall: {
      totalStudents: rows.length,
      activeStudents: rows.filter(r => r.status === 'Active').length,
      totalInvoiced,
      totalCollected,
      totalOutstanding: totalInvoiced - totalCollected,
      attendanceRatePercent: attTotalAll > 0 ? Math.round((attPresentAll / attTotalAll) * 100) : null
    },
    byClass,
    defaulters
  });
});

function csvEscape(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

router.get('/csv', requireAuth, requireRole('admin', 'bursar'), (req, res) => {
  const rows = studentReportRows();
  const header = ['Admission No', 'Name', 'Gender', 'Class', 'Stream', 'Status', 'Guardian Name', 'Guardian Phone', 'Invoice Amount (UGX)', 'Paid (UGX)', 'Balance (UGX)', 'Attendance Days Recorded', 'Days Present', 'Days Absent', 'Attendance Rate %'];
  const lines = [header.map(csvEscape).join(',')];

  for (const r of rows) {
    const balance = (r.invoice_amount || 0) - (r.invoice_paid || 0);
    const rate = r.att_total > 0 ? Math.round((r.att_present / r.att_total) * 100) : '';
    lines.push([
      r.adm_no, r.name, r.gender, r.cls, r.stream || '', r.status,
      r.guardian_name, r.guardian_phone,
      r.invoice_amount || 0, r.invoice_paid || 0, balance,
      r.att_total || 0, r.att_present || 0, r.att_absent || 0, rate
    ].map(csvEscape).join(','));
  }

  const csv = lines.join('\r\n');
  const filename = `gayaza-road-ss-report-${new Date().toISOString().slice(0, 10)}.csv`;

  logAction(req, 'Report exported', `${req.user.name} downloaded the CSV performance report (${rows.length} students)`);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

module.exports = router;
