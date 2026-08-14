const express = require("express");
const router = express.Router();
const { register, verifyOtp, resendOtp, login } = require("../controllers/authController");

router.post("/register", register);     // Step 1: universityId + fullName + email + password -> sends OTP
router.post("/verify-otp", verifyOtp);   // Step 2: universityId + otp -> activates account
router.post("/resend-otp", resendOtp);   // Optional: resend a fresh OTP
router.post("/login", login);            // Step 3: universityId + password -> JWT token

module.exports = router;
