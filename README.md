# Gayaza Road Secondary School — School ERP

A single-database, role-enforced school management system for Gayaza Road
Secondary School (Kyebando, Gayaza Road, Kampala). This is real, runnable
code — not a mockup — but it needs to be run on a machine with Node.js
installed. It was **not** run or tested from within the chat that generated
it (no network/server access there), so treat first boot as a real first
boot: read the errors, they'll be normal Node.js errors.

## What problem this actually solves

Most small Ugandan secondary schools run fees, attendance and admissions as
separate paper ledgers or disconnected spreadsheets kept by different
people. That creates three concrete, common failure modes this system is
built to remove:

1. **No single truth for a student's fee balance.** The bursar's book and
   the parent's memory of what they paid often disagree. Here, a payment
   updates one invoice row in one database — there is no second copy to
   drift out of sync.
2. **No accountability trail.** When money or marks go missing, there's
   often no record of who touched what. Every login, admission, payment
   and settings change is written to `audit_log` with the acting user,
   role, and timestamp, and it cannot be edited from the app.
3. **Absentees found out about too late.** Saving a class register
   automatically compiles which students were absent and emails the admin
   immediately (`ssekitened@gmail.com` by default) so it can be acted on
   same-day, not at end-of-term.

## Real security, not just hidden buttons

- Passwords are hashed with **bcrypt** (12 salt rounds) — never stored or
  logged in plain text.
- Sessions are **signed JWTs** (8-hour expiry) verified on every request.
- Roles are enforced **in the API**, not just hidden in the UI. A teacher's
  token is rejected by the finance endpoints at the server, regardless of
  what the browser sends.
- Basic brute-force throttling on login (8 failed attempts / 15 minutes per
  IP+username).
- Every payment amount is validated against the *server's* current balance,
  never trusted from the browser.

## Setup

```bash
cd gayaza-erp
npm install
cp .env.example .env
```

Open `.env` and set:
- `JWT_SECRET` — generate one with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `ADMIN_EMAIL` — already defaults to `ssekitened@gmail.com`
- `SMTP_USER` / `SMTP_PASS` — your Gmail address and a Gmail **App
  Password** (not your normal password). Steps are in the comments inside
  `.env.example`. Until you fill these in, the app still runs fine —
  notification emails just get logged as "not sent" instead of dispatched,
  and you can see every one of them under **Admin → Notifications**.

Then:

```bash
npm run seed     # creates the database file and demo accounts
npm start        # runs the server
```

Visit `http://localhost:4000`. Demo logins (change these immediately in
`.env`-backed production use — create real accounts under
**Settings → Add Staff/Parent Account** and disable the seeded ones):

| Username | Password      | Role    |
|----------|---------------|---------|
| admin    | Admin@2026!   | Admin / Head Teacher |
| bursar   | Bursar@2026!  | Bursar |
| teacher  | Teacher@2026! | Class Teacher |
| parent   | Parent@2026!  | Parent |

## Where the database actually lives

`school.db` in the project root (path configurable via `DB_PATH`). It's a
single SQLite file — back it up regularly (`cp school.db school.db.bak` on
a cron job, at minimum) since right now there is no automated backup
system built in. For a live multi-user school deployment, moving to
Postgres and hosting on a real server (Render, Railway, a VPS, etc.) is a
natural next step — the route files are written in plain SQL-ish
`better-sqlite3` calls that translate directly.

## What's deliberately not built yet

Payroll/HR, exam marks & report cards, library, transport, boarding,
discipline/sickbay records, gate/visitor logs, and multi-school tenancy.
Each of these would read and write the same `students` table already here
rather than starting a separate system — that's the point of the single
database. Building all of them shallowly at once was explicitly avoided in
favor of a smaller set of modules that are actually complete end-to-end.

## Honest limitations of this build

- Email sending depends on you providing real Gmail credentials — nothing
  will be delivered to `ssekitened@gmail.com` until `SMTP_USER`/`SMTP_PASS`
  are set.
- No automated database backups yet (see above).
- No offline-first sync — needs a live connection to the server.
- JWT logout is client-side only (token just gets discarded); for instant
  server-side revocation you'd add a token-blocklist table.
- Single-server, single-file database — fine for one school on modest
  traffic, not yet built for high concurrency or multiple campuses.
