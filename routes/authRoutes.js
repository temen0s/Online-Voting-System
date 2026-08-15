const express = require("express");
const router = express.Router();
const {
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
} = require("../controllers/authController");
const { verifyVotingToken } = require("../middleware/auth");

router.post("/register", register);     // Step 1: universityId + fullName + email + password -> sends OTP
router.post("/verify-otp", verifyOtp);   // Step 2: universityId + otp -> activates account
router.post("/resend-otp", resendOtp);   // Optional: resend a fresh OTP
router.post("/login", login);            // Step 3: universityId + password -> JWT token
router.get("/verify", verifyVotingToken, verifySession); // Checked on page load before trusting a saved token

// Account management ~ all require a valid voter session
router.get("/profile", verifyVotingToken, getProfile);
router.put("/profile", verifyVotingToken, updateProfile);
router.post("/verify-profile-otp", verifyVotingToken, verifyProfileOtp); // re-verify a newly-changed email
router.post("/resend-profile-otp", verifyVotingToken, resendProfileOtp);
router.post("/change-password", verifyVotingToken, changePassword);

module.exports = router;
