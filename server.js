const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'your-local-secret-key-change-in-production';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connection Pool for XAMPP MySQL
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', // Default XAMPP MySQL password
    database: 'voting_system',
    waitForConnections: true,
    connectionLimit: 10
});

// Middleware: Verify Voter JWT Token
function verifyVotingToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access token required.' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
        req.voterSession = decoded;
        next();
    });
}

// -------------------------------------------------------------------
// ADMIN API ENDPOINTS
// -------------------------------------------------------------------

// Admin Login
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM admins WHERE username = ? AND password = ?', [username, password]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid admin credentials.' });
        }
        const adminToken = jwt.sign({ adminId: rows[0].admin_id, role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
        res.json({ success: true, token: adminToken });
    } catch (err) {
        res.status(500).json({ error: 'Database error during admin authentication.' });
    }
});

// Setup Election Draft
app.post('/api/admin/setup-election', async (req, res) => {
    const { title, categories } = req.body;
    if (!title || !categories || !Array.isArray(categories)) {
        return res.status(400).json({ error: 'Invalid setup payload.' });
    }

    try {
        const [elecResult] = await db.query(
            'INSERT INTO elections (title, status) VALUES (?, "draft")',
            [title]
        );
        const electionId = elecResult.insertId;

        for (const cat of categories) {
            const [catResult] = await db.query(
                'INSERT INTO categories (election_id, category_name) VALUES (?, ?)',
                [electionId, cat.name]
            );
            const categoryId = catResult.insertId;

            for (const cand of cat.candidates) {
                await db.query(
                    'INSERT INTO candidates (category_id, candidate_name, party) VALUES (?, ?, ?)',
                    [categoryId, cand.name, cand.party || '']
                );
            }
        }

        res.json({ success: true, message: 'Election setup saved as draft.', electionId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error during setup.' });
    }
});

// Start Election ("Push GO") with optional Time Limit
app.post('/api/admin/start-election', async (req, res) => {
    const { electionId, durationMinutes } = req.body;
    try {
        await db.query('UPDATE elections SET status = "closed" WHERE status = "active"');

        let endsAt = null;
        if (durationMinutes && parseInt(durationMinutes) > 0) {
            const now = new Date();
            endsAt = new Date(now.getTime() + parseInt(durationMinutes) * 60000);
        }

        await db.query(
            'UPDATE elections SET status = "active", ends_at = ? WHERE election_id = ?',
            [endsAt, electionId]
        );

        await db.query('UPDATE voter_identity SET has_voted = 0');

        res.json({ 
            success: true, 
            message: `Election #${electionId} is now LIVE!`,
            endsAt: endsAt
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to activate election.' });
    }
});

// Manual "End Election"
app.post('/api/admin/end-election', async (req, res) => {
    try {
        await db.query('UPDATE elections SET status = "closed" WHERE status = "active"');
        res.json({ success: true, message: 'Election has been closed successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to close election.' });
    }
});

// -------------------------------------------------------------------
// STUDENT / VOTER API ENDPOINTS
// -------------------------------------------------------------------

// Student Login
app.post('/api/auth', async (req, res) => {
    const { university_id, otp } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM voter_identity WHERE university_id = ?', [university_id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Invalid University ID.' });

        const student = rows[0];
        if (student.otp_code !== otp) return res.status(401).json({ error: 'Invalid OTP code.' });

        const token = jwt.sign(
            { universityId: student.university_id, authorized: true },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({ message: 'Login successful.', token });
    } catch (err) {
        res.status(500).json({ error: 'Authentication failed.' });
    }
});

// Check Voter Status
app.get('/api/voter/status', verifyVotingToken, async (req, res) => {
    try {
        const [voter] = await db.query('SELECT has_voted FROM voter_identity WHERE university_id = ?', [req.voterSession.universityId]);
        if (voter.length === 0) return res.status(404).json({ error: 'Voter not found.' });
        res.json({ hasVoted: Boolean(voter[0].has_voted) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch voter status.' });
    }
});

// Get All Elections (Active & Closed Overview)
app.get('/api/elections/overview', async (req, res) => {
    try {
        const [elections] = await db.query('SELECT election_id, title, status, ends_at FROM elections WHERE status IN ("active", "closed") ORDER BY election_id DESC');
        res.json({ elections });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch elections overview.' });
    }
});

// Get Active Election Ballot (Auto-checks expiration timer)
app.get('/api/election/active', async (req, res) => {
    try {
        const [elections] = await db.query('SELECT * FROM elections WHERE status = "active" LIMIT 1');

        if (elections.length === 0) {
            return res.status(404).json({ error: 'No active election found at this time.' });
        }

        const activeElection = elections[0];

        if (activeElection.ends_at && new Date() > new Date(activeElection.ends_at)) {
            await db.query('UPDATE elections SET status = "closed" WHERE election_id = ?', [activeElection.election_id]);
            return res.status(404).json({ error: 'Election has ended due to time limit expiration.' });
        }

        const [categories] = await db.query('SELECT * FROM categories WHERE election_id = ?', [activeElection.election_id]);

        for (let cat of categories) {
            const [cands] = await db.query('SELECT candidate_id, candidate_name, party FROM candidates WHERE category_id = ?', [cat.category_id]);
            cat.candidates = cands;
        }

        res.json({
            electionId: activeElection.election_id,
            title: activeElection.title,
            endsAt: activeElection.ends_at,
            categories
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve active election ballot.' });
    }
});

// Get Live / Final Results for an Election
app.get('/api/election/:id/results', async (req, res) => {
    const electionId = req.params.id;
    try {
        const [categories] = await db.query('SELECT * FROM categories WHERE election_id = ?', [electionId]);

        for (let cat of categories) {
            const [candidates] = await db.query(`
                SELECT c.candidate_id, c.candidate_name, c.party, 
                       COUNT(b.vote_id) AS vote_count
                FROM candidates c
                LEFT JOIN ballot_box b ON c.candidate_id = b.candidate_id
                WHERE c.category_id = ?
                GROUP BY c.candidate_id
                ORDER BY vote_count DESC
            `, [cat.category_id]);

            cat.candidates = candidates;
        }

        res.json({ electionId, categories });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load election results.' });
    }
});

// Cast Vote
app.post('/api/vote', verifyVotingToken, async (req, res) => {
    const { electionId, votes } = req.body;
    const { universityId } = req.voterSession;

    if (!votes || !Array.isArray(votes) || votes.length === 0) {
        return res.status(400).json({ error: 'Invalid ballot submission.' });
    }

    try {
        const [elec] = await db.query('SELECT status, ends_at FROM elections WHERE election_id = ?', [electionId]);
        if (elec.length === 0 || elec[0].status !== 'active') {
            return res.status(400).json({ error: 'Election is closed or inactive.' });
        }

        if (elec[0].ends_at && new Date() > new Date(elec[0].ends_at)) {
            await db.query('UPDATE elections SET status = "closed" WHERE election_id = ?', [electionId]);
            return res.status(400).json({ error: 'Election has expired.' });
        }

        const [voter] = await db.query('SELECT has_voted FROM voter_identity WHERE university_id = ?', [universityId]);
        if (voter[0].has_voted === 1) {
            return res.status(403).json({ error: 'You have already submitted your ballot.' });
        }

        await db.query('UPDATE voter_identity SET has_voted = 1 WHERE university_id = ?', [universityId]);

        const receiptHashes = [];
        for (const item of votes) {
            const voteId = crypto.randomUUID();
            const timestamp = new Date().toISOString();
            const voteHash = crypto.createHash('sha256').update(`${voteId}-${item.candidateId}-${timestamp}`).digest('hex');

            await db.query(
                'INSERT INTO ballot_box (vote_id, election_id, category_id, candidate_id, vote_hash) VALUES (?, ?, ?, ?, ?)',
                [voteId, electionId, item.categoryId, item.candidateId, voteHash]
            );

            receiptHashes.push(voteHash);
        }

        res.json({
            success: true,
            message: 'Ballot successfully cast!',
            receipts: receiptHashes
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Transaction failed.' });
    }
});

app.listen(PORT, () => {
    console.log(`Node.js API running at http://localhost:${PORT}`);
});