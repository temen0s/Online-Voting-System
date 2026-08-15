const express = require("express");
const router = express.Router();
const { register, verifyOtp, resendOtp, login, verifySession } = require("../controllers/authController");
const { verifyVotingToken } = require("../middleware/auth");

router.post("/register", register);     // Step 1: universityId + fullName + email + password -> sends OTP
router.post("/verify-otp", verifyOtp);   // Step 2: universityId + otp -> activates account
router.post("/resend-otp", resendOtp);   // Optional: resend a fresh OTP
router.post("/login", login);            // Step 3: universityId + password -> JWT token
router.get("/verify", verifyVotingToken, verifySession); // Checked on page load before trusting a saved token

module.exports = router;
