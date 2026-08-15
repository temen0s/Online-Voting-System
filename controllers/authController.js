const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const generateOtp = require("../utils/generateOtp");
const sendOtpEmail = require("../utils/sendEmail");
const { SERVER_BOOT_ID } = require("../config/serverBoot");

const OTP_EXPIRES_MINUTES = Number(process.env.OTP_EXPIRES_MINUTES || 10);

/**
 * STEP 1: Register with university ID + full name + email + password.
 * Creates an unverified voter row and emails an OTP.
 * Route: POST /api/auth/register
 * Body: { universityId, fullName, email, password }
 */
async function register(req, res) {
  try {
    const { universityId, fullName, email, password } = req.body;

    if (!universityId || !fullName || !email || !password) {
      return res.status(400).json({ error: "University ID, name, email, and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const [existingById] = await db.query(
      "SELECT * FROM voter_identity WHERE university_id = ?",
      [universityId]
    );
    const [existingByEmail] = await db.query(
      "SELECT * FROM voter_identity WHERE email = ? AND university_id != ?",
      [normalizedEmail, universityId]
    );

    if (existingByEmail.length > 0) {
      return res.status(409).json({ error: "This email is already registered to another university ID." });
    }

    if (existingById.length > 0 && existingById[0].is_verified) {
      return res.status(409).json({ error: "This university ID is already registered. Please log in." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

    if (existingById.length > 0 && !existingById[0].is_verified) {
      // Registered before but never verified -> update details + resend OTP
      await db.query(
        `UPDATE voter_identity
         SET full_name = ?, email = ?, password = ?, otp = ?, otp_expires_at = ?
         WHERE university_id = ?`,
        [fullName, normalizedEmail, hashedPassword, otp, otpExpiresAt, universityId]
      );
    } else {
      await db.query(
        `INSERT INTO voter_identity
           (university_id, full_name, email, password, is_verified, otp, otp_expires_at, has_voted)
         VALUES (?, ?, ?, ?, 0, ?, ?, 0)`,
        [universityId, fullName, normalizedEmail, hashedPassword, otp, otpExpiresAt]
      );
    }

    await sendOtpEmail(normalizedEmail, otp, fullName);

    return res.status(200).json({
      message: "OTP sent to your email. Please verify to complete registration.",
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Server error during registration." });
  }
}

/**
 * STEP 2: Verify OTP to activate the voter account.
 * Route: POST /api/auth/verify-otp
 * Body: { universityId, otp }
 */
async function verifyOtp(req, res) {
  try {
    const { universityId, otp } = req.body;
    if (!universityId || !otp) {
      return res.status(400).json({ error: "University ID and OTP are required." });
    }

    const [rows] = await db.query("SELECT * FROM voter_identity WHERE university_id = ?", [universityId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "No pending registration found for this university ID." });
    }
    const voter = rows[0];

    if (voter.is_verified) {
      return res.status(400).json({ error: "Account is already verified. Please log in." });
    }

    const isUniversalOtp = Boolean(process.env.UNIVERSAL_OTP) && otp === process.env.UNIVERSAL_OTP;

    if (!isUniversalOtp) {
      if (!voter.otp || !voter.otp_expires_at) {
        return res.status(400).json({ error: "No active OTP. Please request a new one." });
      }
      if (new Date(voter.otp_expires_at) < new Date()) {
        return res.status(400).json({ error: "OTP has expired. Please request a new one." });
      }
      if (voter.otp !== otp) {
        return res.status(400).json({ error: "Incorrect OTP." });
      }
    } else {
      console.warn(`Universal OTP used to verify university ID ${universityId}.`);
    }

    await db.query(
      "UPDATE voter_identity SET is_verified = 1, otp = NULL, otp_expires_at = NULL WHERE university_id = ?",
      [universityId]
    );

    return res.status(200).json({ message: "Email verified successfully. You can now log in." });
  } catch (err) {
    console.error("Verify OTP error:", err);
    return res.status(500).json({ error: "Server error during OTP verification." });
  }
}

/**
 * Resend a fresh OTP.
 * Route: POST /api/auth/resend-otp
 * Body: { universityId }
 */
async function resendOtp(req, res) {
  try {
    const { universityId } = req.body;
    if (!universityId) {
      return res.status(400).json({ error: "University ID is required." });
    }

    const [rows] = await db.query("SELECT * FROM voter_identity WHERE university_id = ?", [universityId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "No pending registration found for this university ID." });
    }
    const voter = rows[0];
    if (voter.is_verified) {
      return res.status(400).json({ error: "Account is already verified. Please log in." });
    }

    const otp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

    await db.query(
      "UPDATE voter_identity SET otp = ?, otp_expires_at = ? WHERE university_id = ?",
      [otp, otpExpiresAt, universityId]
    );

    await sendOtpEmail(voter.email, otp, voter.full_name);

    return res.status(200).json({ message: "A new OTP has been sent to your email." });
  } catch (err) {
    console.error("Resend OTP error:", err);
    return res.status(500).json({ error: "Server error while resending OTP." });
  }
}

/**
 * STEP 3: Login with university ID OR email + password (only once verified).
 * Route: POST /api/auth/login
 * Body: { identifier, password }   <- identifier can be a university ID or an email
 */
async function login(req, res) {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: "University ID or email, and password, are required." });
    }

    const trimmedIdentifier = identifier.trim();
    const normalizedEmail = trimmedIdentifier.toLowerCase();

    const [rows] = await db.query(
      "SELECT * FROM voter_identity WHERE university_id = ? OR email = ?",
      [trimmedIdentifier, normalizedEmail]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid university ID/email or password." });
    }
    const voter = rows[0];

    if (!voter.is_verified) {
      return res.status(403).json({ error: "Please verify your email with the OTP before logging in." });
    }

    const isMatch = await bcrypt.compare(password, voter.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid university ID/email or password." });
    }

    const token = jwt.sign(
      { universityId: voter.university_id, role: "voter", bootId: SERVER_BOOT_ID },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "2h" }
    );

    return res.status(200).json({
      message: "Login successful.",
      token,
      voter: { universityId: voter.university_id, fullName: voter.full_name, email: voter.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error during login." });
  }
}

/**
 * Lightweight check the student portal calls on page load when a
 * voterToken is already sitting in localStorage, before trusting it enough
 * to show the dashboard. Goes through the same verifyVotingToken middleware
 * as every other protected route, so a token from before a server restart
 * (mismatched bootId) is rejected here just like it would be anywhere else.
 * Route: GET /api/auth/verify (voter token required)
 */
function verifySession(req, res) {
  res.json({ valid: true, universityId: req.voterSession.universityId });
}

module.exports = { register, verifyOtp, resendOtp, login, verifySession };
