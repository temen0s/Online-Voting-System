require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("../config/db");

// Test accounts ~ plaintext password shown here is what you type into
// the login form. The script hashes it before storing it, exactly like
// real registration does. is_verified is set to 1 directly, so these
// accounts skip the OTP-email step entirely.
const TEST_VOTERS = [
  { universityId: "STU1001", fullName: "Alex Smith", email: "alex.smith.test@example.com", password: "test1234" },
  { universityId: "STU1002", fullName: "Jordan Lee", email: "jordan.lee.test@example.com", password: "test1234" },
  { universityId: "STU1003", fullName: "Riley Chen", email: "riley.chen.test@example.com", password: "test1234" },
];

async function seed() {
  try {
    for (const voter of TEST_VOTERS) {
      const hashed = await bcrypt.hash(voter.password, 10);

      await db.query(
        `INSERT INTO voter_identity
           (university_id, full_name, email, password, is_verified, otp, otp_expires_at, has_voted)
         VALUES (?, ?, ?, ?, 1, NULL, NULL, 0)
         ON DUPLICATE KEY UPDATE
           full_name = VALUES(full_name),
           email = VALUES(email),
           password = VALUES(password),
           is_verified = 1,
           otp = NULL,
           otp_expires_at = NULL,
           has_voted = 0`,
        [voter.universityId, voter.fullName, voter.email, hashed]
      );

      console.log(`Seeded: ${voter.universityId} / password: ${voter.password}`);
    }

    console.log("\nDone. You can log in at http://localhost:3000 with any of the above.");
  } catch (err) {
    console.error("Seeding failed:", err.message);
  } finally {
    process.exit(0);
  }
}

seed();
