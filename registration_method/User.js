const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String, // stored as a bcrypt hash, never plain text
      required: true,
    },
    isVerified: {
      type: Boolean,
      default: false, // becomes true only after OTP verification
    },
    otp: {
      type: String, // 6-digit code, cleared after successful verification
      default: null,
    },
    otpExpiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
