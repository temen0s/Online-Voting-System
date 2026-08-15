const jwt = require("jsonwebtoken");
const { SERVER_BOOT_ID } = require("../config/serverBoot");

function getToken(req) {
  const authHeader = req.headers["authorization"];
  return authHeader && authHeader.split(" ")[1];
}

// Verifies a student/voter JWT (issued at login after OTP-verified registration)
function verifyVotingToken(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: "Access token required." });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err || decoded.role !== "voter") {
      return res.status(403).json({ error: "Invalid or expired token." });
    }
    // The server was restarted since this token was issued ~ treat it as
    // logged out even though the signature itself still checks out.
    if (decoded.bootId !== SERVER_BOOT_ID) {
      return res.status(401).json({
        error: "The server was restarted. Please log in again.",
        reason: "server_restarted",
      });
    }
    req.voterSession = decoded;
    next();
  });
}

// Verifies an admin JWT ~ required before any election-management action
function verifyAdminToken(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: "Admin access token required." });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err || decoded.role !== "admin") {
      return res.status(403).json({ error: "Invalid or expired admin token." });
    }
    // Same restart check as above ~ an admin session shouldn't survive the
    // server being closed and started back up.
    if (decoded.bootId !== SERVER_BOOT_ID) {
      return res.status(401).json({
        error: "The server was restarted. Please log in again.",
        reason: "server_restarted",
      });
    }
    req.adminSession = decoded;
    next();
  });
}

module.exports = { verifyVotingToken, verifyAdminToken };
