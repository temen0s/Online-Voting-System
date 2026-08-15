const express = require("express");
const router = express.Router();
const electionController = require("../controllers/electionController");
const { verifyVotingToken } = require("../middleware/auth");

// Public read endpoints
router.get("/elections/overview", electionController.electionsOverview);
router.get("/election/:id/ballot", electionController.electionBallot);
router.get("/election/:id/results", electionController.electionResults);

// Voter-protected endpoints
router.get("/voter/status", verifyVotingToken, electionController.voterStatus);
router.post("/vote", verifyVotingToken, electionController.castVote);

module.exports = router;
