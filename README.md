# Secure Online Voting System

A full student election system: self-service registration with email OTP
verification, anonymous ballot casting, live results, and an admin panel
to run elections. This merges two previously separate pieces —

- **Voting engine** (admin panel, student ballot/results, MySQL) — the
  original `server.js` / `public/*` / `Voting_system.sql`.
- **Registration & auth** (email + password + OTP) — originally built
  against MongoDB in `registration_method/`, now **ported onto the same
  MySQL database** so the whole app runs on one datastore and one server.

## What changed in the merge

- Students now **register themselves** (university ID, name, email,
  password) instead of being pre-seeded by an admin with a fixed OTP.
  Registration emails a 6-digit OTP that must be verified before login.
- Login uses **university ID + password** (bcrypt-hashed), not a
  reusable static OTP.
- The `voter_identity` table gained `email`, `password`, `is_verified`,
  `otp`, `otp_expires_at` columns.
- **Admin passwords are now bcrypt-hashed**, not plaintext. A default
  admin is auto-created from `.env` on first boot instead of being
  seeded in the SQL file.
- **Admin election-management routes are now authenticated.**
  Previously `/api/admin/setup-election`, `/start-election`, and
  `/end-election` had no auth check at all — anyone could hit them
  directly. They now require the admin JWT (`admin.html` sends it
  automatically).
- The JWT secret moved out of source code and into `.env`.
- Code is split into `config/`, `controllers/`, `routes/`,
  `middleware/`, `utils/` instead of one large `server.js`.
- The ballot box remains deliberately **decoupled from voter identity**
  — casting a vote never writes a link between `university_id` and the
  `ballot_box` row, so votes stay anonymous even though the system
  knows *that* a student voted.

## Project structure

```
voting-system/
├── server.js                 # app entry point
├── config/
│   ├── db.js                 # MySQL connection pool
│   └── seedAdmin.js          # auto-creates a default admin on first run
├── middleware/
│   └── auth.js               # verifyVotingToken / verifyAdminToken
├── controllers/
│   ├── authController.js     # student register / verify-otp / resend-otp / login
│   ├── adminController.js    # admin login
│   └── electionController.js # setup/start/end election, ballots, results, voting
├── routes/
│   ├── authRoutes.js
│   ├── adminRoutes.js
│   └── electionRoutes.js
├── utils/
│   ├── generateOtp.js
│   └── sendEmail.js
├── public/
│   ├── index.html             # student portal (login / register / OTP / voting)
│   ├── admin-login.html
│   └── admin.html             # admin election controls
├── Voting_system.sql          # schema (run this once)
├── .env.example
└── package.json
```

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create the database**
   ```bash
   mysql -u root -p < Voting_system.sql
   ```
   (Or import `Voting_system.sql` via phpMyAdmin if you're on XAMPP.)

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env`:
   - `DB_*` — your MySQL connection details.
   - `JWT_SECRET` — a long random string. Generate one with:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
   - `EMAIL_USER` / `EMAIL_PASS` — for Gmail, enable 2-Step Verification
     then create an **App Password** at
     myaccount.google.com/apppasswords. Your normal Gmail password will
     not work here.
   - `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` — used once, to
     create the first admin account on server startup. **Change this
     password after your first login** (there's no "change password"
     UI yet — update it directly in the `admins` table with a new
     bcrypt hash, or delete the row and restart the server to
     re-seed).

4. **Run it**
   ```bash
   npm start        # or: npm run dev  (with nodemon)
   ```
   Server runs at `http://localhost:3000` (or your `PORT`).

## Using it

- **Students:** go to `/` → Register tab → fill in university ID, name,
  email, password → check email for OTP → verify → log in → vote once
  an election is active.
- **Admins:** go to `/admin-login.html`, log in with the seeded admin
  account, then use `/admin.html` to draft an election, add categories
  and candidates, push it live (optionally with a time limit), and end
  it manually or let it expire.

## API summary

### Student auth — `/api/auth`
| Method | Route          | Body                                             |
|--------|----------------|---------------------------------------------------|
| POST   | `/register`    | `{ universityId, fullName, email, password }`     |
| POST   | `/verify-otp`  | `{ universityId, otp }`                            |
| POST   | `/resend-otp`  | `{ universityId }`                                 |
| POST   | `/login`       | `{ universityId, password }` → `{ token, voter }`  |

### Admin — `/api/admin` (all but login require `Authorization: Bearer <adminToken>`)
| Method | Route              | Body |
|--------|--------------------|------|
| POST   | `/login`           | `{ username, password }` → `{ token }` |
| POST   | `/setup-election`  | `{ title, categories: [{ name, candidates: [{name, party}] }] }` |
| POST   | `/start-election`  | `{ electionId, durationMinutes? }` |
| POST   | `/end-election`    | — |

### Elections / voting — `/api`
| Method | Route                        | Auth required |
|--------|-------------------------------|----------------|
| GET    | `/elections/overview`         | no |
| GET    | `/election/active`            | no |
| GET    | `/election/:id/results`       | no |
| GET    | `/voter/status`               | voter token |
| POST   | `/vote`                       | voter token, body `{ electionId, votes: [{categoryId, candidateId}] }` |

## Before you deploy publicly

- Rotate `JWT_SECRET` and the default admin password — don't ship the
  values from `.env.example`.
- Put the app behind HTTPS (a reverse proxy like Nginx or your hosting
  platform's TLS termination).
- Consider rate-limiting `/api/auth/login`, `/api/auth/register`, and
  `/api/admin/login` to slow down brute-force attempts.
- Add a real "change admin password" flow if more than one admin will
  use this, or if you plan to keep the account past initial setup.
- MySQL user should have only the privileges this app needs (not `root`
  with a blank password, which is fine for local XAMPP dev only).


*//Test Students:
Seeded: STU1001 / password: test1234
Seeded: STU1002 / password: test1234
Seeded: STU1003 / password: test1234

