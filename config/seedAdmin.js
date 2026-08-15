const bcrypt = require("bcryptjs");
const db = require("./db");

/**
 * If the admins table is empty, create one default admin from
 * DEFAULT_ADMIN_USERNAME / DEFAULT_ADMIN_PASSWORD in .env, with a
 * bcrypt-hashed password. This means no plaintext admin credential
 * ever needs to live in the SQL file or the repo.
 */
async function seedAdminIfNeeded() {
  try {
    const [rows] = await db.query("SELECT COUNT(*) AS count FROM admins");
    if (rows[0].count > 0) return;

    const username = process.env.DEFAULT_ADMIN_USERNAME || "admin";
    const password = process.env.DEFAULT_ADMIN_PASSWORD || "change_me_immediately";
    const hashed = await bcrypt.hash(password, 10);

    await db.query("INSERT INTO admins (username, password) VALUES (?, ?)", [username, hashed]);

    console.log("=".repeat(60));
    console.log(`No admin account found ~ created default admin "${username}"`);
    console.log("Log in and change this password immediately.");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("Admin seeding skipped (DB not ready?):", err.message);
  }
}

module.exports = seedAdminIfNeeded;
