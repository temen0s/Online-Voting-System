# Secure Online Voting System

A full student election system: self-service registration with email OTP
verification, anonymous ballot casting, live results, and an admin panel
to run elections. This merges two previously separate pieces ~

- **Voting engine** (admin panel, student ballot/results, MySQL) ~ the
  original `server.js` / `public/*` / `Voting_system.sql`.
- **Registration & auth** (email + password + OTP) ~ originally built
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
  `/end-election` had no auth check at all ~ anyone could hit them
  directly. They now require the admin JWT (`admin.html` sends it
  automatically).
- The JWT secret moved out of source code and into `.env`.
- Code is split into `config/`, `controllers/`, `routes/`,
  `middleware/`, `utils/` instead of one large `server.js`.
- The ballot box remains deliberately **decoupled from voter identity**
  ~ casting a vote never writes a link between `university_id` and the
  `ballot_box` row, so votes stay anonymous even though the system
  knows *that* a student voted.

## Multiple concurrent elections

Elections no longer force each other to close. An admin can save any
number of drafts and have any number of them live at the same time
(e.g. "Student Council 2026" and "Club Board Elections" both running
at once). This required two changes beyond the UI:

- `start-election` / `end-election` now act on one specific
  `electionId` instead of "whichever election is currently active."
- Vote status moved off a single global `has_voted` flag on
  `voter_identity` and into a new `election_votes` table keyed by
  `(university_id, election_id)`, so a student's "have I voted"
  status is tracked separately per election. See `Voting_system.sql`.

Each election now has its own dedicated control page,
`admin-election.html?id=<id>`, opened in a separate tab from
`admin.html` ~ it shows a live countdown, live vote count, and the
Start/End controls for that one election. `admin-results.html` lists
every closed election with a link into its results.

## Project structure

```
voting-system/
├── server.js                 # app entry point
├── config/
│   ├── db.js                 # MySQL connection pool
│   ├── seedAdmin.js          # auto-creates a default admin on first run
│   └── serverBoot.js         # random ID per process start, used to invalidate old tokens on restart
├── middleware/
│   └── auth.js               # verifyVotingToken / verifyAdminToken
├── controllers/
│   ├── authController.js     # student register / verify-otp / resend-otp / login
│   ├── adminController.js    # admin login
│   └── electionController.js # setup/list/detail/start/end election, ballots, results, voting
├── routes/
│   ├── authRoutes.js
│   ├── adminRoutes.js
│   └── electionRoutes.js
├── utils/
│   ├── generateOtp.js
│   └── sendEmail.js
├── public/
│   ├── styles.css             # shared stylesheet + design tokens for all five pages
│   ├── inactivity-guard.js    # 7-minute idle logout, shared by every page
│   ├── index.html             # student portal (login / register / OTP / voting)
│   ├── admin-login.html
│   ├── admin.html             # elections dashboard ~ create drafts, list all elections
│   ├── admin-election.html    # per-election control window (configure/launch/live/results)
│   └── admin-results.html     # history of closed elections
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
   If you already had this database from before `elections` gained
   `started_at`/`ended_at` columns, you don't need to re-run the whole
   file ~ just the two `ALTER TABLE` lines near the top of it.

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env`:
   - `DB_*` ~ your MySQL connection details.
   - `JWT_SECRET` ~ a long random string. Generate one with:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
   - `EMAIL_USER` / `EMAIL_PASS` ~ for Gmail, enable 2-Step Verification
     then create an **App Password** at
     myaccount.google.com/apppasswords. Your normal Gmail password will
     not work here.
   - `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` ~ used once, to
     create the first admin account on server startup. **Change this
     password after your first login** (there's no "change password"
     UI yet ~ update it directly in the `admins` table with a new
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
- **Admins:** go to `/admin-login.html` (linked from a small pill on the
  student portal), log in with the seeded admin account, then use
  `/admin.html` to draft as many elections as you like. Saving a draft
  offers to open that election's own control page
  (`admin-election.html`), where you can still edit the title,
  categories, and candidates (add/remove either) for as long as it
  stays a draft, set a time limit, launch it, watch live results, and
  end it ~ independently of any other election you have running. As
  with the create form on `admin.html`, the first category in the
  editor can't be deleted (there's always at least one), but every
  category after it has a Delete (X) button. If
  you edit the draft and forget to click "Save Changes," the page
  shows an "Unsaved changes" warning, disables Start Election until
  you save (or reload to discard), and warns before you close/leave
  the tab ~ so a forgotten save can't accidentally launch the old
  saved data instead of your edits. A
  draft that's no longer needed can be deleted from that same page;
  once it's live or closed, editing and deleting are both no longer
  available from the admin panel ~ that's intentionally left to direct
  database access. An election can't be launched until every one of
  its categories has at least 2 candidates (otherwise it's not really
  a contest). Both students and admins are automatically signed out
  after 7 minutes of inactivity.
- **`admin.html` vs `admin-results.html`.** "Your Elections" on
  `admin.html` only ever shows live elections and drafts (live
  pinned to the top, drafts after), kept deliberately minimal with
  no timestamps ~ it's for quick access, not history.
  `admin-results.html` shows every election you've created, in the
  same live-then-draft priority order, then closed elections last
  sorted most-recently-ended first. Each card shows only the
  timestamps that make sense for its status: a draft shows when it
  was saved, a live election shows when voting started, and a closed
  one shows both when voting started and when it ended.
  `admin-election.html`'s per-election page shows the same timing
  line for whichever one election it's looking at. If a timestamp
  isn't on record for an election (e.g. it was closed before this
  feature existed), that line is just left off.
- **Restarting the server logs everyone out.** Every login (admin or
  student) is tagged with a random ID generated fresh each time the
  server process starts (`config/serverBoot.js`). Closing `server.js`
  and running `npm start` again generates a new ID, so every token
  issued before the restart is rejected on its next API call even
  though `JWT_SECRET` hasn't changed. Whichever page a stale session
  loads ~ `admin.html`, `admin-election.html`, `admin-results.html`,
  or the student dashboard on `index.html` ~ it clears both the
  `adminToken` and `voterToken` from local storage and drops back to
  `index.html`, so a token from before the restart can't be reused
  in either portal. This closes the gap where restarting the server
  (intentionally, after a crash, or by someone unauthorized) would
  otherwise leave old browser sessions still logged in.

## Styling

All five pages share `public/styles.css`. The colours, radii and
font sizes are CSS custom properties declared in `:root` at the top
of that file, and every rule below references them ~ so changing
`--color-primary` once restyles every primary button, link and
accent across the whole app. Each page keeps only a tiny `<style>`
block for genuinely page-specific layout (its container width, or
the centred login card).

Before this, each page carried its own copy of the same button,
badge, card and modal rules with hardcoded hex values, so a single
colour change meant editing five files. If you're picking this up
as a designer, the comment block at the top of `styles.css` lists
the known cleanup items ~ two competing button naming schemes,
spacing still hardcoded in px, and the fact that the responsive
rules at the bottom are a starting point rather than a finished
mobile design.

## API summary

### Student auth ~ `/api/auth`
| Method | Route          | Body                                             |
|--------|----------------|---------------------------------------------------|
| POST   | `/register`    | `{ universityId, fullName, email, password }`     |
| POST   | `/verify-otp`  | `{ universityId, otp }`                            |
| POST   | `/resend-otp`  | `{ universityId }`                                 |
| POST   | `/login`       | `{ universityId, password }` → `{ token, voter }`  |
| GET    | `/verify`      | voter token ~ used on page load to confirm a saved token still works |

### Admin ~ `/api/admin` (all but login require `Authorization: Bearer <adminToken>`)
| Method | Route              | Body |
|--------|--------------------|------|
| POST   | `/login`           | `{ username, password }` → `{ token }` |
| POST   | `/setup-election`  | `{ title, categories: [{ name, candidates: [{name, party}] }] }` → creates a new draft |
| GET    | `/elections`       | ~ → list of every draft/active/closed election with counts, `created_at`, `started_at`, `ended_at`. `admin.html` filters this to active/draft, `admin-results.html` filters it to closed |
| GET    | `/election/:id`    | ~ → full detail (categories, candidates, vote counts) for one election |
| PUT    | `/election/:id`    | `{ title, categories: [{ name, candidates: [{name, party}] }] }` ~ replaces a draft's title/categories/candidates. 403 if not a draft |
| POST   | `/start-election`  | `{ electionId, durationMinutes? }` ~ only works on a draft election, and only if every category has at least 2 candidates |
| POST   | `/end-election`    | `{ electionId }` ~ only works on an active election |
| DELETE | `/election/:id`    | ~ → deletes a draft election (and its categories/candidates). 403 if the election is active or closed ~ those can only be removed directly in the database |

### Elections / voting ~ `/api`
| Method | Route                        | Auth required |
|--------|-------------------------------|----------------|
| GET    | `/elections/overview`         | no |
| GET    | `/election/:id/ballot`        | no (categories/candidates for one active election) |
| GET    | `/election/:id/results`       | no |
| GET    | `/voter/status?electionId=`   | voter token ~ vote status for one specific election |
| POST   | `/vote`                       | voter token, body `{ electionId, votes: [{categoryId, candidateId}] }` |

## Before you deploy publicly

- Rotate `JWT_SECRET` and the default admin password ~ don't ship the
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

