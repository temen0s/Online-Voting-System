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

/**
 * Returns the logged-in student's own profile.
 * Route: GET /api/auth/profile (voter token required)
 */
async function getProfile(req, res) {
  try {
    const [rows] = await db.query(
      "SELECT university_id, full_name, email, is_verified, created_at FROM voter_identity WHERE university_id = ?",
      [req.voterSession.universityId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Account not found." });
    }
    const voter = rows[0];
    return res.status(200).json({
      universityId: voter.university_id,
      fullName: voter.full_name,
      email: voter.email,
      isVerified: Boolean(voter.is_verified),
      createdAt: voter.created_at,
    });
  } catch (err) {
    console.error("Get profile error:", err);
    return res.status(500).json({ error: "Server error while loading profile." });
  }
}

/**
 * Updates full name and/or email. Requires the current password as
 * confirmation ~ this is an account-security-relevant action, so a
 * bare voter JWT (which could be sitting in an unlocked browser tab)
 * shouldn't be enough on its own. Changing the email re-locks the
 * account behind OTP verification, exactly like registration did,
 * so a session token alone can't redirect future OTPs to a different
 * inbox without the real password.
 * Route: PUT /api/auth/profile (voter token required)
 * Body: { fullName, email, currentPassword }
 */
async function updateProfile(req, res) {
  try {
    const { fullName, email, currentPassword } = req.body;
    const { universityId } = req.voterSession;

    if (!fullName || !email || !currentPassword) {
      return res.status(400).json({ error: "Full name, email, and current password are required." });
    }

    const [rows] = await db.query("SELECT * FROM voter_identity WHERE university_id = ?", [universityId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Account not found." });
    }
    const voter = rows[0];

    const isMatch = await bcrypt.compare(currentPassword, voter.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const trimmedName = fullName.trim();
    const normalizedEmail = email.toLowerCase().trim();
    const emailChanged = normalizedEmail !== voter.email;

    if (emailChanged) {
      const [existingByEmail] = await db.query(
        "SELECT university_id FROM voter_identity WHERE email = ? AND university_id != ?",
        [normalizedEmail, universityId]
      );
      if (existingByEmail.length > 0) {
        return res.status(409).json({ error: "This email is already registered to another university ID." });
      }

      const otp = generateOtp();
      const otpExpiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

      await db.query(
        `UPDATE voter_identity
         SET full_name = ?, email = ?, is_verified = 0, otp = ?, otp_expires_at = ?
         WHERE university_id = ?`,
        [trimmedName, normalizedEmail, otp, otpExpiresAt, universityId]
      );

      await sendOtpEmail(normalizedEmail, otp, trimmedName);

      return res.status(200).json({
        message: "Profile saved. Your new email needs to be verified ~ we sent a fresh OTP to it.",
        emailChanged: true,
      });
    }

    await db.query("UPDATE voter_identity SET full_name = ? WHERE university_id = ?", [trimmedName, universityId]);
    return res.status(200).json({ message: "Profile updated.", emailChanged: false });
  } catch (err) {
    console.error("Update profile error:", err);
    return res.status(500).json({ error: "Server error while updating profile." });
  }
}

/**
 * Re-verifies a new email set via updateProfile, using the same OTP
 * mechanism as registration. Kept as its own endpoint (rather than
 * reusing /verify-otp) so the profile page can call something that's
 * explicitly scoped to the logged-in voter's own session instead of
 * taking a bare universityId in the body.
 * Route: POST /api/auth/verify-profile-otp (voter token required)
 * Body: { otp }
 */
async function verifyProfileOtp(req, res) {
  try {
    const { otp } = req.body;
    const { universityId } = req.voterSession;
    if (!otp) {
      return res.status(400).json({ error: "OTP is required." });
    }

    const [rows] = await db.query("SELECT * FROM voter_identity WHERE university_id = ?", [universityId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Account not found." });
    }
    const voter = rows[0];

    if (voter.is_verified) {
      return res.status(400).json({ error: "Your email is already verified." });
    }
    if (!voter.otp || !voter.otp_expires_at) {
      return res.status(400).json({ error: "No active OTP. Please resend and try again." });
    }
    if (new Date(voter.otp_expires_at) < new Date()) {
      return res.status(400).json({ error: "OTP has expired. Please resend and try again." });
    }
    if (voter.otp !== otp) {
      return res.status(400).json({ error: "Incorrect OTP." });
    }

    await db.query(
      "UPDATE voter_identity SET is_verified = 1, otp = NULL, otp_expires_at = NULL WHERE university_id = ?",
      [universityId]
    );

    return res.status(200).json({ message: "Email verified successfully." });
  } catch (err) {
    console.error("Verify profile OTP error:", err);
    return res.status(500).json({ error: "Server error during OTP verification." });
  }
}

/**
 * Resends a fresh OTP for a new email set via updateProfile. Voter-
 * session-scoped counterpart to /resend-otp for the same reason
 * verifyProfileOtp exists separately from /verify-otp.
 * Route: POST /api/auth/resend-profile-otp (voter token required)
 */
async function resendProfileOtp(req, res) {
  try {
    const { universityId } = req.voterSession;
    const [rows] = await db.query("SELECT * FROM voter_identity WHERE university_id = ?", [universityId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Account not found." });
    }
    const voter = rows[0];
    if (voter.is_verified) {
      return res.status(400).json({ error: "Your email is already verified." });
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
    console.error("Resend profile OTP error:", err);
    return res.status(500).json({ error: "Server error while resending OTP." });
  }
}

/**
 * Changes the account password. Requires the current password.
 * Route: POST /api/auth/change-password (voter token required)
 * Body: { currentPassword, newPassword }
 */
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    const { universityId } = req.voterSession;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters." });
    }

    const [rows] = await db.query("SELECT * FROM voter_identity WHERE university_id = ?", [universityId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Account not found." });
    }
    const voter = rows[0];

    const isMatch = await bcrypt.compare(currentPassword, voter.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const isSame = await bcrypt.compare(newPassword, voter.password);
    if (isSame) {
      return res.status(400).json({ error: "New password must be different from your current password." });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE voter_identity SET password = ? WHERE university_id = ?", [hashed, universityId]);

    return res.status(200).json({ message: "Password changed successfully." });
  } catch (err) {
    console.error("Change password error:", err);
    return res.status(500).json({ error: "Server error while changing password." });
  }
}

module.exports = {
  register,
  verifyOtp,
  resendOtp,
  login,
  verifySession,
  getProfile,
  updateProfile,
  verifyProfileOtp,
  resendProfileOtp,
  changePassword,
};
