const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const generateOtp = require("../utils/generateOtp");
const sendOtpEmail = require("../utils/sendEmail");

const OTP_EXPIRES_MINUTES = Number(process.env.OTP_EXPIRES_MINUTES || 10);

/**
 * STEP 1: Register with email + password.
 * Creates an unverified user and emails them an OTP.
 * Route: POST /api/auth/register
 * Body: { email, password }
 */
const register = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });

    if (existingUser && existingUser.isVerified) {
      return res.status(409).json({ message: "Email is already registered. Please log in." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

    if (existingUser && !existingUser.isVerified) {
      // User signed up before but never verified -> update credentials + resend OTP
      existingUser.password = hashedPassword;
      existingUser.otp = otp;
      existingUser.otpExpiresAt = otpExpiresAt;
      await existingUser.save();
    } else {
      // Brand new registration
      await User.create({
        email: email.toLowerCase(),
        password: hashedPassword,
        isVerified: false,
        otp,
        otpExpiresAt,
      });
    }

    await sendOtpEmail(email, otp);

    return res.status(200).json({
      message: "OTP sent to your email. Please verify to complete registration.",
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ message: "Server error during registration" });
  }
};

/**
 * STEP 2: Verify OTP to activate the account.
 * Route: POST /api/auth/verify-otp
 * Body: { email, otp }
 */
const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ message: "No pending registration found for this email" });
    }
    if (user.isVerified) {
      return res.status(400).json({ message: "Account is already verified. Please log in." });
    }
    if (!user.otp || !user.otpExpiresAt) {
      return res.status(400).json({ message: "No active OTP. Please request a new one." });
    }
    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    }
    if (user.otp !== otp) {
      return res.status(400).json({ message: "Incorrect OTP" });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpiresAt = null;
    await user.save();

    return res.status(200).json({ message: "Email verified successfully. You can now log in." });
  } catch (err) {
    console.error("Verify OTP error:", err);
    return res.status(500).json({ message: "Server error during OTP verification" });
  }
};

/**
 * Resend a fresh OTP (useful if the first one expired).
 * Route: POST /api/auth/resend-otp
 * Body: { email }
 */
const resendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: "No pending registration found for this email" });
    }
    if (user.isVerified) {
      return res.status(400).json({ message: "Account is already verified. Please log in." });
    }

    const otp = generateOtp();
    user.otp = otp;
    user.otpExpiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);
    await user.save();

    await sendOtpEmail(email, otp);

    return res.status(200).json({ message: "A new OTP has been sent to your email" });
  } catch (err) {
    console.error("Resend OTP error:", err);
    return res.status(500).json({ message: "Server error while resending OTP" });
  }
};

/**
 * STEP 3: Login with email + password (only allowed once verified).
 * Route: POST /api/auth/login
 * Body: { email, password }
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    if (!user.isVerified) {
      return res.status(403).json({ message: "Please verify your email with the OTP before logging in" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
    );

    return res.status(200).json({
      message: "Login successful",
      token,
      user: { id: user._id, email: user.email },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Server error during login" });
  }
};

module.exports = { register, verifyOtp, resendOtp, login };
