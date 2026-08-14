const jwt = require("jsonwebtoken");

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
    req.voterSession = decoded;
    next();
  });
}

// Verifies an admin JWT — required before any election-management action
function verifyAdminToken(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: "Admin access token required." });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err || decoded.role !== "admin") {
      return res.status(403).json({ error: "Invalid or expired admin token." });
    }
    req.adminSession = decoded;
    next();
  });
}

module.exports = { verifyVotingToken, verifyAdminToken };
