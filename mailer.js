// utils/mailer.js
// Sends real emails to the admin address via SMTP (Gmail App Password) once
// configured. Every attempt - sent or not - is written to email_log so
// nothing is silently lost, and the in-app Notifications page (admin only)
// shows the full history even if SMTP was never set up.
require('dotenv').config();
const nodemailer = require('nodemailer');
const db = require('./database');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ssekitened@gmail.com';

let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function notifyAdmin(subject, body) {
  const to = ADMIN_EMAIL;
  let status;
  if (!transporter) {
    status = 'not_sent (SMTP not configured - see .env.example)';
  } else {
    try {
      await transporter.sendMail({
        from: `"Gayaza Road SS ERP" <${process.env.SMTP_USER}>`,
        to,
        subject,
        text: body
      });
      status = 'sent';
    } catch (err) {
      status = `failed: ${err.message}`;
    }
  }
  db.prepare('INSERT INTO email_log (to_email, subject, body, status) VALUES (?,?,?,?)')
    .run(to, subject, body, status);
  return status;
}

module.exports = { notifyAdmin, ADMIN_EMAIL };
