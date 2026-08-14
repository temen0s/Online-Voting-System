const crypto = require("crypto");
const db = require("../config/db");

// -------------------------------------------------------------------
// ADMIN-ONLY ELECTION MANAGEMENT
// -------------------------------------------------------------------

// Setup Election Draft
async function setupElection(req, res) {
  const { title, categories } = req.body;
  if (!title || !categories || !Array.isArray(categories)) {
    return res.status(400).json({ error: "Invalid setup payload." });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [elecResult] = await conn.query(
      'INSERT INTO elections (title, status) VALUES (?, "draft")',
      [title]
    );
    const electionId = elecResult.insertId;

    for (const cat of categories) {
      if (!cat.name || !Array.isArray(cat.candidates)) continue;

      const [catResult] = await conn.query(
        "INSERT INTO categories (election_id, category_name) VALUES (?, ?)",
        [electionId, cat.name]
      );
      const categoryId = catResult.insertId;

      for (const cand of cat.candidates) {
        if (!cand.name) continue;
        await conn.query(
          "INSERT INTO candidates (category_id, candidate_name, party) VALUES (?, ?, ?)",
          [categoryId, cand.name, cand.party || ""]
        );
      }
    }

    await conn.commit();
    res.json({ success: true, message: "Election setup saved as draft.", electionId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Database error during setup." });
  } finally {
    conn.release();
  }
}

// Start Election ("Push GO") with optional time limit
async function startElection(req, res) {
  const { electionId, durationMinutes } = req.body;
  if (!electionId) {
    return res.status(400).json({ error: "electionId is required." });
  }

  try {
    await db.query('UPDATE elections SET status = "closed" WHERE status = "active"');

    let endsAt = null;
    if (durationMinutes && parseInt(durationMinutes, 10) > 0) {
      endsAt = new Date(Date.now() + parseInt(durationMinutes, 10) * 60000);
    }

    await db.query(
      'UPDATE elections SET status = "active", ends_at = ? WHERE election_id = ?',
      [endsAt, electionId]
    );

    await db.query("UPDATE voter_identity SET has_voted = 0 WHERE is_verified = 1");

    res.json({
      success: true,
      message: `Election #${electionId} is now LIVE!`,
      endsAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to activate election." });
  }
}

// Manual "End Election"
async function endElection(req, res) {
  try {
    await db.query('UPDATE elections SET status = "closed" WHERE status = "active"');
    res.json({ success: true, message: "Election has been closed successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to close election." });
  }
}

// -------------------------------------------------------------------
// STUDENT / VOTER READ ENDPOINTS
// -------------------------------------------------------------------

// Check Voter Status
async function voterStatus(req, res) {
  try {
    const [voter] = await db.query(
      "SELECT has_voted FROM voter_identity WHERE university_id = ?",
      [req.voterSession.universityId]
    );
    if (voter.length === 0) return res.status(404).json({ error: "Voter not found." });
    res.json({ hasVoted: Boolean(voter[0].has_voted) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch voter status." });
  }
}

// Get All Elections (Active & Closed Overview)
async function electionsOverview(req, res) {
  try {
    const [elections] = await db.query(
      'SELECT election_id, title, status, ends_at FROM elections WHERE status IN ("active", "closed") ORDER BY election_id DESC'
    );
    res.json({ elections });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch elections overview." });
  }
}

// Get Active Election Ballot (auto-checks expiration timer)
async function activeElection(req, res) {
  try {
    const [elections] = await db.query('SELECT * FROM elections WHERE status = "active" LIMIT 1');
    if (elections.length === 0) {
      return res.status(404).json({ error: "No active election found at this time." });
    }

    const election = elections[0];

    if (election.ends_at && new Date() > new Date(election.ends_at)) {
      await db.query('UPDATE elections SET status = "closed" WHERE election_id = ?', [election.election_id]);
      return res.status(404).json({ error: "Election has ended due to time limit expiration." });
    }

    const [categories] = await db.query("SELECT * FROM categories WHERE election_id = ?", [election.election_id]);

    for (const cat of categories) {
      const [cands] = await db.query(
        "SELECT candidate_id, candidate_name, party FROM candidates WHERE category_id = ?",
        [cat.category_id]
      );
      cat.candidates = cands;
    }

    res.json({
      electionId: election.election_id,
      title: election.title,
      endsAt: election.ends_at,
      categories,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve active election ballot." });
  }
}

// Get Live / Final Results for an Election
async function electionResults(req, res) {
  const electionId = req.params.id;
  try {
    const [categories] = await db.query("SELECT * FROM categories WHERE election_id = ?", [electionId]);

    for (const cat of categories) {
      const [candidates] = await db.query(
        `SELECT c.candidate_id, c.candidate_name, c.party,
                COUNT(b.vote_id) AS vote_count
         FROM candidates c
         LEFT JOIN ballot_box b ON c.candidate_id = b.candidate_id
         WHERE c.category_id = ?
         GROUP BY c.candidate_id
         ORDER BY vote_count DESC`,
        [cat.category_id]
      );
      cat.candidates = candidates;
    }

    res.json({ electionId, categories });
  } catch (err) {
    res.status(500).json({ error: "Failed to load election results." });
  }
}

// Cast Vote — anonymized: ballot_box rows carry no voter identifier
async function castVote(req, res) {
  const { electionId, votes } = req.body;
  const { universityId } = req.voterSession;

  if (!votes || !Array.isArray(votes) || votes.length === 0) {
    return res.status(400).json({ error: "Invalid ballot submission." });
  }

  const conn = await db.getConnection();
  try {
    const [elec] = await conn.query("SELECT status, ends_at FROM elections WHERE election_id = ?", [electionId]);
    if (elec.length === 0 || elec[0].status !== "active") {
      conn.release();
      return res.status(400).json({ error: "Election is closed or inactive." });
    }

    if (elec[0].ends_at && new Date() > new Date(elec[0].ends_at)) {
      await conn.query('UPDATE elections SET status = "closed" WHERE election_id = ?', [electionId]);
      conn.release();
      return res.status(400).json({ error: "Election has expired." });
    }

    const [voter] = await conn.query("SELECT has_voted FROM voter_identity WHERE university_id = ?", [universityId]);
    if (voter.length === 0) {
      conn.release();
      return res.status(404).json({ error: "Voter not found." });
    }
    if (voter[0].has_voted === 1) {
      conn.release();
      return res.status(403).json({ error: "You have already submitted your ballot." });
    }

    await conn.beginTransaction();

    // Flip has_voted first, in its own statement, with no vote_id linkage
    // written anywhere back to voter_identity — this is what keeps the
    // ballot anonymous even though we know *that* this voter voted.
    await conn.query("UPDATE voter_identity SET has_voted = 1 WHERE university_id = ?", [universityId]);

    const receiptHashes = [];
    for (const item of votes) {
      const voteId = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      const voteHash = crypto.createHash("sha256").update(`${voteId}-${item.candidateId}-${timestamp}`).digest("hex");

      await conn.query(
        "INSERT INTO ballot_box (vote_id, election_id, category_id, candidate_id, vote_hash) VALUES (?, ?, ?, ?, ?)",
        [voteId, electionId, item.categoryId, item.candidateId, voteHash]
      );

      receiptHashes.push(voteHash);
    }

    await conn.commit();

    res.json({
      success: true,
      message: "Ballot successfully cast!",
      receipts: receiptHashes,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Transaction failed." });
  } finally {
    conn.release();
  }
}

module.exports = {
  setupElection,
  startElection,
  endElection,
  voterStatus,
  electionsOverview,
  activeElection,
  electionResults,
  castVote,
};
