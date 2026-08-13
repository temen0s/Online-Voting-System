# Voting System — Email + OTP Auth

Register with email/password → OTP sent to email → verify OTP → login.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `MONGO_URI` (local MongoDB or MongoDB Atlas connection string)
   - `JWT_SECRET` (any long random string)
   - `EMAIL_USER` / `EMAIL_PASS` — for Gmail, enable 2-Step Verification on
     the account, then create an **App Password** at
     myaccount.google.com/apppasswords and use that as `EMAIL_PASS`
     (your normal Gmail password will not work).
3. `npm run dev` (or `npm start`)

Server runs at `http://localhost:5000`.

## Endpoints

### 1. Register — `POST /api/auth/register`
```json
{ "email": "user@example.com", "password": "secret123" }
```
Creates an unverified account and emails a 6-digit OTP (expires in
`OTP_EXPIRES_MINUTES`).

### 2. Verify OTP — `POST /api/auth/verify-otp`
```json
{ "email": "user@example.com", "otp": "042917" }
```
Marks the account verified. Login is blocked until this succeeds.

### 3. Resend OTP — `POST /api/auth/resend-otp`
```json
{ "email": "user@example.com" }
```

### 4. Login — `POST /api/auth/login`
```json
{ "email": "user@example.com", "password": "secret123" }
```
Returns a JWT on success:
```json
{ "message": "Login successful", "token": "...", "user": { "id": "...", "email": "..." } }
```
Use this token as `Authorization: Bearer <token>` on protected routes
(e.g. casting a vote) in the rest of your voting system.

## How it works

- Passwords are hashed with `bcryptjs` before saving — never stored in plain text.
- A user document starts with `isVerified: false` and holds the current
  OTP + its expiry.
- Verifying the correct, non-expired OTP flips `isVerified` to `true`
  and clears the OTP fields.
- Login checks `isVerified` first, then compares the password hash.
- JWT (`jsonwebtoken`) is issued on login so the rest of the voting
  system (casting votes, viewing results) can be protected with an
  auth middleware that checks this token.

## Quick test with curl

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"secret123"}'

curl -X POST http://localhost:5000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","otp":"123456"}'

curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"secret123"}'
```
