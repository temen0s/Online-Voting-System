// Generates a random 6-digit numeric OTP as a string, e.g. "042917"
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = generateOtp;
