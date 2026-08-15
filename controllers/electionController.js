const crypto = require("crypto");
const db = require("../config/db");

// -------------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------------

// Auto-close any active election whose time limit has passed. Several
// elections can be active at once now, so this is a bulk sweep rather
// than a single-row check.
async function autoExpireElections() {
  try {
    await db.query(
      'UPDATE elections SET status = "closed", ended_at = NOW() WHERE status = "active" AND ends_at IS NOT NULL AND ends_at <= NOW()'
    );
  } catch (err) {
    console.error("Auto-expire check failed:", err);
  }
}

async function fetchElectionWithResults(electionId) {
  const [elecRows] = await db.query(
    "SELECT election_id, title, status, ends_at, started_at, ended_at, created_at FROM elections WHERE election_id = ?",
    [electionId]
  );
  if (elecRows.length === 0) return null;
  const election = elecRows[0];

  const [categories] = await db.query("SELECT * FROM categories WHERE election_id = ?", [electionId]);

  let totalVotes = 0;
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
    totalVotes += candidates.reduce((sum, c) => sum + Number(c.vote_count), 0);
  }

  return {
    electionId: election.election_id,
    title: election.title,
    status: election.status,
    endsAt: election.ends_at,
    startedAt: election.started_at,
    endedAt: election.ended_at,
    createdAt: election.created_at,
    totalVotes,
    categories,
  };
}

// -------------------------------------------------------------------
// ADMIN-ONLY ELECTION MANAGEMENT
// -------------------------------------------------------------------

// Setup Election Draft ~ creates a brand new election every time, so
// admins can have any number of drafts/active/closed elections at once.
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

// Edit a draft's title, categories, and candidates. Restricted to
// status === "draft" for the same reason deletion is: once an election
// is live, its ballot is what voters have already seen (or voted on),
// so it can't be silently rewritten from here. Implemented as a full
// replace ~ existing categories are dropped (cascading to their
// candidates) and re-inserted from the submitted payload, all inside
// one transaction, so a partial failure can't leave the draft in a
// half-updated state.
async function updateElection(req, res) {
  const electionId = req.params.id;
  const { title, categories } = req.body;

  if (!title || !categories || !Array.isArray(categories)) {
    return res.status(400).json({ error: "Invalid update payload." });
  }

  const conn = await db.getConnection();
  try {
    const [rows] = await conn.query("SELECT status FROM elections WHERE election_id = ?", [electionId]);
    if (rows.length === 0) {
      conn.release();
      return res.status(404).json({ error: "Election not found." });
    }
    if (rows[0].status !== "draft") {
      conn.release();
      return res.status(403).json({
        error: "Only draft elections can be edited. Live or closed elections can't be changed from here.",
      });
    }

    await conn.beginTransaction();

    await conn.query("UPDATE elections SET title = ? WHERE election_id = ?", [title, electionId]);
    await conn.query("DELETE FROM categories WHERE election_id = ?", [electionId]);

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
    res.json({ success: true, message: "Draft updated." });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Failed to update draft." });
  } finally {
    conn.release();
  }
}

// List every election (draft/active/closed) for the admin dashboard,
// with quick counts so the dashboard doesn't need N+1 requests.
async function listElections(req, res) {
  try {
    await autoExpireElections();

    const [elections] = await db.query(`
      SELECT e.election_id, e.title, e.status, e.ends_at, e.started_at, e.ended_at, e.created_at,
        (SELECT COUNT(*) FROM categories c WHERE c.election_id = e.election_id) AS category_count,
        (SELECT COUNT(*) FROM candidates cd
           JOIN categories c2 ON cd.category_id = c2.category_id
           WHERE c2.election_id = e.election_id) AS candidate_count,
        (SELECT COUNT(*) FROM ballot_box b WHERE b.election_id = e.election_id) AS total_votes
      FROM elections e
      ORDER BY e.election_id DESC
    `);

    res.json({ elections });
  } catch (err) {
    console.error(err);
    // Most likely cause: the elections table is missing started_at/
    // ended_at (added for the admin/results split). Surface that
    // directly instead of a generic message, since it's a one-time
    // migration the admin needs to run, not a real bug.
    if (err.code === "ER_BAD_FIELD_ERROR") {
      return res.status(500).json({
        error:
          "Database is missing the started_at/ended_at columns on the elections table. Run the two ALTER TABLE lines near the top of Voting_system.sql (in phpMyAdmin or the mysql CLI), then reload this page.",
      });
    }
    res.status(500).json({ error: "Failed to fetch elections." });
  }
}

// Full detail for a single election, for the per-election admin
// control/results window. Works for draft, active, or closed.
async function adminElectionDetail(req, res) {
  try {
    await autoExpireElections();

    const detail = await fetchElectionWithResults(req.params.id);
    if (!detail) return res.status(404).json({ error: "Election not found." });

    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load election detail." });
  }
}

// Start Election with optional time limit. No longer closes other
// active elections ~ any number of elections can be live at once.
async function startElection(req, res) {
  const { electionId, durationMinutes } = req.body;
  if (!electionId) {
    return res.status(400).json({ error: "electionId is required." });
  }

  try {
    const [rows] = await db.query("SELECT status FROM elections WHERE election_id = ?", [electionId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Election not found." });
    }
    if (rows[0].status !== "draft") {
      return res.status(400).json({
        error: `This election is already ${rows[0].status} and can't be started again.`,
      });
    }

    const [categoryCounts] = await db.query(
      `SELECT c.category_id, c.category_name, COUNT(cd.candidate_id) AS candidate_count
       FROM categories c
       LEFT JOIN candidates cd ON cd.category_id = c.category_id
       WHERE c.election_id = ?
       GROUP BY c.category_id`,
      [electionId]
    );

    if (categoryCounts.length === 0) {
      return res.status(400).json({ error: "Add at least one category before starting this election." });
    }

    const underfilled = categoryCounts
      .filter((cat) => Number(cat.candidate_count) < 2)
      .map((cat) => cat.category_name);

    if (underfilled.length > 0) {
      return res.status(400).json({
        error: `Every category needs at least 2 candidates before this election can go live. Add more candidates to: ${underfilled.join(", ")}.`,
      });
    }

    let endsAt = null;
    if (durationMinutes && parseInt(durationMinutes, 10) > 0) {
      endsAt = new Date(Date.now() + parseInt(durationMinutes, 10) * 60000);
    }

    await db.query(
      'UPDATE elections SET status = "active", ends_at = ?, started_at = NOW() WHERE election_id = ?',
      [endsAt, electionId]
    );

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

// Manual "End Election" ~ now scoped to one electionId, since several
// elections can be active at the same time.
async function endElection(req, res) {
  const { electionId } = req.body;
  if (!electionId) {
    return res.status(400).json({ error: "electionId is required." });
  }

  try {
    const [rows] = await db.query("SELECT status FROM elections WHERE election_id = ?", [electionId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Election not found." });
    }
    if (rows[0].status !== "active") {
      return res.status(400).json({ error: "This election is not currently active." });
    }

    await db.query('UPDATE elections SET status = "closed", ended_at = NOW() WHERE election_id = ?', [electionId]);
    res.json({ success: true, message: "Election has been closed successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to close election." });
  }
}

// Delete a draft election. Deliberately restricted to status === "draft":
// once an election has gone live, its ballot and any published results
// are not something the admin UI should be able to erase ~ removing a
// live or closed election is left to a developer working directly
// against the database. Deleting the elections row cascades (via the
// existing foreign keys) to its categories and candidates automatically.
async function deleteElection(req, res) {
  const electionId = req.params.id;

  try {
    const [rows] = await db.query("SELECT status FROM elections WHERE election_id = ?", [electionId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Election not found." });
    }
    if (rows[0].status !== "draft") {
      return res.status(403).json({
        error:
          "Only draft elections can be deleted here. Live or closed elections can't be removed from the admin panel ~ that has to be done directly in the database.",
      });
    }

    await db.query("DELETE FROM elections WHERE election_id = ?", [electionId]);
    res.json({ success: true, message: "Draft deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete draft." });
  }
}

// -------------------------------------------------------------------
// STUDENT / VOTER READ ENDPOINTS
// -------------------------------------------------------------------

// Check Voter Status for one specific election (a student can have
// voted in some concurrently-running elections and not others).
async function voterStatus(req, res) {
  const { electionId } = req.query;
  if (!electionId) {
    return res.status(400).json({ error: "electionId query parameter is required." });
  }

  try {
    const [rows] = await db.query(
      "SELECT 1 FROM election_votes WHERE university_id = ? AND election_id = ? LIMIT 1",
      [req.voterSession.universityId, electionId]
    );
    res.json({ hasVoted: rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch voter status." });
  }
}

// Get Voting History ~ every election a student has participated in.
// Deliberately returns only *that* a ballot was cast and *when*
// (sourced from election_votes), never which candidate. ballot_box
// carries no link back to university_id by design (see schema notes
// in Voting_system.sql), so the server has no way to hand candidate
// choices back out after the fact without breaking ballot anonymity.
// If a student wants to see the receipt hash(es) for a specific vote,
// those were returned once at cast time (see castVote below) and are
// saved client-side only ~ the student portal's voting-history page
// merges them in from localStorage rather than from this endpoint.
async function votingHistory(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT ev.election_id, ev.voted_at, e.title, e.status, e.started_at, e.ended_at
       FROM election_votes ev
       JOIN elections e ON e.election_id = ev.election_id
       WHERE ev.university_id = ?
       ORDER BY ev.voted_at DESC`,
      [req.voterSession.universityId]
    );
    res.json({ history: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load voting history." });
  }
}

// Get All Elections (Active & Closed Overview) ~ shown to students.
async function electionsOverview(req, res) {
  try {
    await autoExpireElections();

    const [elections] = await db.query(
      'SELECT election_id, title, status, ends_at FROM elections WHERE status IN ("active", "closed") ORDER BY election_id DESC'
    );
    res.json({ elections });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch elections overview." });
  }
}

// Get a specific election's ballot (auto-checks expiration timer).
// Replaces the old singular "/election/active" endpoint now that
// several elections can be active at once ~ students pick which
// election to open from the overview list, so the ballot fetch has
// to be scoped to that specific electionId.
async function electionBallot(req, res) {
  const electionId = req.params.id;
  try {
    const [elections] = await db.query("SELECT * FROM elections WHERE election_id = ?", [electionId]);
    if (elections.length === 0) {
      return res.status(404).json({ error: "Election not found." });
    }

    const election = elections[0];

    if (election.status !== "active") {
      return res.status(404).json({ error: "This election is not currently active." });
    }

    if (election.ends_at && new Date() > new Date(election.ends_at)) {
      await db.query('UPDATE elections SET status = "closed", ended_at = NOW() WHERE election_id = ?', [election.election_id]);
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
    res.status(500).json({ error: "Failed to retrieve election ballot." });
  }
}

// Get Live / Final Results for an Election ~ used by both the student
// results view and the admin per-election window.
async function electionResults(req, res) {
  try {
    const detail = await fetchElectionWithResults(req.params.id);
    if (!detail) return res.status(404).json({ error: "Election not found." });

    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: "Failed to load election results." });
  }
}

// Cast Vote ~ anonymized: ballot_box rows carry no voter identifier.
// Vote status is tracked per-election in election_votes, so a student
// can vote once in each of several concurrently-running elections.
async function castVote(req, res) {
  const { electionId, votes } = req.body;
  const { universityId } = req.voterSession;

  if (!electionId || !votes || !Array.isArray(votes) || votes.length === 0) {
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
      await conn.query('UPDATE elections SET status = "closed", ended_at = NOW() WHERE election_id = ?', [electionId]);
      conn.release();
      return res.status(400).json({ error: "Election has expired." });
    }

    const [already] = await conn.query(
      "SELECT 1 FROM election_votes WHERE university_id = ? AND election_id = ? LIMIT 1",
      [universityId, electionId]
    );
    if (already.length > 0) {
      conn.release();
      return res.status(403).json({ error: "You have already submitted your ballot for this election." });
    }

    await conn.beginTransaction();

    // Recorded first so a duplicate-key error (two simultaneous
    // submissions) aborts the transaction before any ballot rows
    // are written, instead of after.
    await conn.query(
      "INSERT INTO election_votes (university_id, election_id) VALUES (?, ?)",
      [universityId, electionId]
    );

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
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(403).json({ error: "You have already submitted your ballot for this election." });
    }
    console.error(err);
    res.status(500).json({ error: "Transaction failed." });
  } finally {
    conn.release();
  }
}

module.exports = {
  setupElection,
  updateElection,
  listElections,
  adminElectionDetail,
  startElection,
  endElection,
  deleteElection,
  voterStatus,
  votingHistory,
  electionsOverview,
  electionBallot,
  electionResults,
  castVote,
};
