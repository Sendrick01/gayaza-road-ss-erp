// utils/audit.js
const db = require('./database');

function logAction(req, action, detail) {
  const user = req.user || { id: null, username: 'system', role: null };
  db.prepare('INSERT INTO audit_log (user_id, username, role, action, detail, ip) VALUES (?,?,?,?,?,?)')
    .run(user.id, user.username, user.role, action, detail, req.ip || null);
}

module.exports = { logAction };
