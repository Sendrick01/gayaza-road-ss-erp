// middleware/auth.js
// Server-side enforcement. This is the critical difference from a browser-only
// demo: a teacher's JWT is physically incapable of getting through
// requireRole('admin','bursar') on the finance routes, no matter what the
// frontend does or doesn't hide.
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, role, name }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Your role (${req.user.role}) is not permitted to do this.` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
