// server.js
require('dotenv').config();
const db = require('./db/database'); // ensures schema exists on boot
const express = require('express');
const cors = require('cors');
const path = require('path');

// First-boot auto-seed: if there are zero users yet (fresh database, e.g.
// a brand new deployment on Render with no shell access to run `npm run
// seed` manually), seed the demo accounts and starting data automatically.
// This only fires once - after that, users exist, so it's skipped on every
// later restart and won't ever reset a password you've already changed.
const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (userCount === 0) {
  console.log('No users found - running first-boot seed automatically...');
  const { seedDatabase } = require('./db/seed');
  seedDatabase();
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change_this_to_a_long_random_string') {
  console.warn('\n[WARNING] JWT_SECRET is missing or still the default placeholder.');
  console.warn('Set a real random value in .env before using this outside your own machine.\n');
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/students', require('./routes/students'));
app.use('/api/fees', require('./routes/fees'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api', require('./routes/misc')); // dashboard, settings, audit, notifications, parent

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Fallback to the single-page app for any non-API route
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Gayaza Road SS ERP running at http://localhost:${PORT}`);
  console.log(`Database file: ${process.env.DB_PATH || './school.db'}`);
});
