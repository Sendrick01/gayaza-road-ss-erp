// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');
const { requireAuth, requireRole } = require('./auth-middleware');
const { logAction } = require('./audit');
const router = express.Router();

// Simple in-memory rate limiting per IP+username to blunt brute-force login
// attempts. For a production deployment behind a real load balancer, move
// this to Redis or a proper rate-limit middleware instead.
const attempts = new Map(); // key -> { count, firstAt }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function tooManyAttempts(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > WINDOW_MS) { attempts.delete(key); return false; }
  return rec.count >= MAX_ATTEMPTS;
}
function recordFailedAttempt(key) {
  const rec = attempts.get(key) || { count: 0, firstAt: Date.now() };
  rec.count += 1;
  attempts.set(key, rec);
}
function clearAttempts(key) { attempts.delete(key); }

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const key = `${req.ip}:${username}`;
  if (tooManyAttempts(key)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    recordFailedAttempt(key);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    recordFailedAttempt(key);
    logAction({ user: { id: user.id, username, role: user.role }, ip: req.ip }, 'Failed login', 'Incorrect password');
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  clearAttempts(key);
  const payload = { id: user.id, username: user.username, role: user.role, name: user.name };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });

  logAction({ user: payload, ip: req.ip }, 'Login', `${user.name} signed in as ${user.role}`);

  res.json({ token, user: payload });
});

// Public, but tightly gated: a parent can only create an account if the
// admission number AND guardian phone they submit exactly match a real
// student record already in the database. This is what makes self-service
// signup safe - nobody can register as "parent of student X" without
// already knowing information a real guardian would have, and it's
// rate-limited the same way login is to blunt automated guessing.
router.post('/parent-signup', (req, res) => {
  const { adm_no, guardian_phone, username, password } = req.body || {};
  if (!adm_no || !guardian_phone || !username || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const key = `signup:${req.ip}`;
  if (tooManyAttempts(key)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes, or contact the school office.' });
  }

  const normalizedAdmNo = adm_no.trim();
  const normalizedPhone = guardian_phone.replace(/\s+/g, '');
  const student = db.prepare('SELECT * FROM students WHERE adm_no = ?').get(normalizedAdmNo);

  if (!student || student.guardian_phone.replace(/\s+/g, '') !== normalizedPhone) {
    recordFailedAttempt(key);
    logAction({ user: { id: null, username: 'anonymous', role: null }, ip: req.ip }, 'Failed parent signup', `Admission number or phone did not match any record (adm_no attempted: ${normalizedAdmNo})`);
    // Deliberately vague error - doesn't reveal whether the admission
    // number exists but the phone was wrong, vs. the admission number
    // not existing at all, so this can't be used to enumerate students.
    return res.status(400).json({ error: 'Those details do not match any student record. Please check with the school office.' });
  }

  const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUsername) {
    return res.status(409).json({ error: 'That username is already taken. Please choose another.' });
  }

  clearAttempts(key);
  const hash = bcrypt.hashSync(password, 12);
  const txn = db.transaction(() => {
    const info = db.prepare('INSERT INTO users (username, password_hash, role, name, email) VALUES (?,?,\'parent\',?,NULL)')
      .run(username, hash, student.guardian_name);
    db.prepare('INSERT INTO parent_students (user_id, student_id) VALUES (?, ?)').run(info.lastInsertRowid, student.id);
    return info.lastInsertRowid;
  });
  txn();

  logAction({ user: { id: null, username, role: 'parent' }, ip: req.ip }, 'Parent self-registered', `${student.guardian_name} created their own portal account and linked ${student.name} (${student.adm_no})`);
  res.status(201).json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/logout', requireAuth, (req, res) => {
  logAction(req, 'Logout', `${req.user.name} signed out`);
  // JWTs are stateless - real invalidation requires a server-side denylist
  // or short expiry + refresh tokens. 8h expiry above is the practical
  // control here; add a token blocklist table if you need instant revoke.
  res.json({ ok: true });
});

// Admin-only: change any user's password (also lets a user change their own).
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  logAction(req, 'Password changed', `${req.user.name} changed their own password`);
  res.json({ ok: true });
});

// Admin-only: create a new staff/parent account
router.post('/users', requireAuth, requireRole('admin'), (req, res) => {
  const { username, password, role, name, email, student_adm_nos } = req.body || {};
  if (!username || !password || !role || !name) return res.status(400).json({ error: 'username, password, role and name are required.' });
  if (!['admin', 'bursar', 'teacher', 'parent'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'That username is already taken.' });

  // For parent accounts, resolve a comma-separated list of admission
  // numbers (e.g. "GRSS/2026/0001, GRSS/2026/0002" for siblings) into
  // actual student links - this is deliberately a plain text field rather
  // than a fancy multi-select, since it's fast to type on a phone and an
  // admission number is something the office always has on hand.
  let studentIds = [];
  if (role === 'parent' && student_adm_nos) {
    const admNos = student_adm_nos.split(',').map(s => s.trim()).filter(Boolean);
    const notFound = [];
    for (const admNo of admNos) {
      const s = db.prepare('SELECT id FROM students WHERE adm_no = ?').get(admNo);
      if (s) studentIds.push(s.id); else notFound.push(admNo);
    }
    if (notFound.length) return res.status(400).json({ error: `Admission number(s) not found: ${notFound.join(', ')}` });
  }

  const hash = bcrypt.hashSync(password, 12);
  const txn = db.transaction(() => {
    const info = db.prepare('INSERT INTO users (username, password_hash, role, name, email) VALUES (?,?,?,?,?)')
      .run(username, hash, role, name, email || null);
    for (const sid of studentIds) {
      db.prepare('INSERT OR IGNORE INTO parent_students (user_id, student_id) VALUES (?, ?)').run(info.lastInsertRowid, sid);
    }
    return info.lastInsertRowid;
  });
  const userId = txn();

  logAction(req, 'User created', `Created ${role} account "${username}" (${name})${studentIds.length ? `, linked to ${studentIds.length} student(s)` : ''}`);
  res.status(201).json({ id: userId });
});

module.exports = router;
