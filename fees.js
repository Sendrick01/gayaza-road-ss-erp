// routes/fees.js
const express = require('express');
const db = require('./database');
const { requireAuth, requireRole } = require('./auth-middleware');
const { logAction } = require('./audit');
const { notifyAdmin } = require('./mailer');
const router = express.Router();

router.get('/invoices', requireAuth, requireRole('admin', 'bursar'), (req, res) => {
  const { status, q } = req.query;
  const rows = db.prepare(`
    SELECT invoices.*, students.name AS student_name, students.adm_no, students.cls, students.stream
    FROM invoices JOIN students ON students.id = invoices.student_id
    ORDER BY invoices.id DESC
  `).all();

  const withStatus = rows.map(r => {
    const balance = r.amount - r.paid;
    const st = balance <= 0 ? 'paid' : (r.paid > 0 ? 'partial' : 'unpaid');
    return { ...r, balance, status: st };
  }).filter(r => {
    const matchStatus = !status || r.status === status;
    const matchQ = !q || r.student_name.toLowerCase().includes(q.toLowerCase()) || r.adm_no.toLowerCase().includes(q.toLowerCase());
    return matchStatus && matchQ;
  });

  res.json(withStatus);
});

router.get('/summary', requireAuth, requireRole('admin', 'bursar'), (req, res) => {
  const rows = db.prepare('SELECT amount, paid FROM invoices').all();
  const collected = rows.reduce((s, r) => s + r.paid, 0);
  const outstanding = rows.reduce((s, r) => s + Math.max(0, r.amount - r.paid), 0);
  const defaulters = rows.filter(r => r.amount - r.paid > 0).length;
  res.json({ collected, outstanding, defaulters, totalInvoices: rows.length });
});

// Bursar/Admin only. This is the money-touching endpoint, so it is the most
// tightly guarded route in the app: role-checked, amount-validated against
// the real remaining balance server-side (never trusts the client's math),
// wrapped in a DB transaction, and immediately emailed + audit-logged.
router.post('/invoices/:id/payments', requireAuth, requireRole('admin', 'bursar'), (req, res) => {
  const { amount, method } = req.body || {};
  const invoiceId = Number(req.params.id);
  const amt = Number(amount);

  if (!amt || amt <= 0) return res.status(400).json({ error: 'Enter a valid payment amount.' });

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  const balance = invoice.amount - invoice.paid;
  if (amt > balance) return res.status(400).json({ error: `Amount exceeds outstanding balance of UGX ${balance.toLocaleString()}.` });

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(invoice.student_id);
  const receiptNo = 'RCT-' + Date.now().toString().slice(-8) + '-' + invoiceId;

  const txn = db.transaction(() => {
    db.prepare('UPDATE invoices SET paid = paid + ? WHERE id = ?').run(amt, invoiceId);
    db.prepare(`
      INSERT INTO payments (invoice_id, student_id, amount, method, receipt_no, recorded_by)
      VALUES (?,?,?,?,?,?)
    `).run(invoiceId, invoice.student_id, amt, method || 'Cash', receiptNo, req.user.username);
  });
  txn();

  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  const newBalance = updated.amount - updated.paid;

  logAction(req, 'Payment recorded', `UGX ${amt.toLocaleString()} (${method || 'Cash'}) for ${student.name} (${student.adm_no}). New balance: UGX ${newBalance.toLocaleString()}.`);
  notifyAdmin(
    'Payment received - Gayaza Road SS',
    `${req.user.name} (${req.user.role}) recorded a payment.\n\nStudent: ${student.name} (${student.adm_no})\nAmount: UGX ${amt.toLocaleString()}\nMethod: ${method || 'Cash'}\nReceipt No: ${receiptNo}\nRemaining balance: UGX ${newBalance.toLocaleString()}\n\nThis is an automated notification.`
  ).catch(() => {});

  res.status(201).json({
    receiptNo,
    invoice: { ...updated, balance: newBalance },
    student: { name: student.name, adm_no: student.adm_no }
  });
});

router.get('/structures', requireAuth, requireRole('admin', 'bursar'), (req, res) => {
  res.json(db.prepare('SELECT * FROM fee_structures ORDER BY cls').all());
});

router.put('/structures/:cls', requireAuth, requireRole('admin'), (req, res) => {
  const { amount } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
  db.prepare('INSERT INTO fee_structures (cls, amount) VALUES (?, ?) ON CONFLICT(cls) DO UPDATE SET amount = excluded.amount')
    .run(req.params.cls, amount);
  logAction(req, 'Fee structure updated', `${req.params.cls} term fee set to UGX ${Number(amount).toLocaleString()}`);
  res.json({ ok: true });
});

module.exports = router;
