const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const electionController = require("../controllers/electionController");
const { verifyAdminToken } = require("../middleware/auth");

router.post("/login", adminController.login);

// Everything below requires a valid admin JWT
router.post("/setup-election", verifyAdminToken, electionController.setupElection);
router.post("/start-election", verifyAdminToken, electionController.startElection);
router.post("/end-election", verifyAdminToken, electionController.endElection);

module.exports = router;
