const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'your-local-secret-key-change-in-production';

app.use(express.json());

// Serve frontend HTML/CSS/JS files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Connection Pool for XAMPP MySQL
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',      // Default XAMPP MySQL password is empty
    database: 'voting_system',
    waitForConnections: true,
    connectionLimit: 10
});

// Middleware: Verify Token
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

// 0. Admin Login (Database-driven)
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
        const [rows] = await db.query(
            'SELECT * FROM admins WHERE username = ? AND password = ?',
            [username, password]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        const admin = rows[0];
        const token = jwt.sign(
            { id: admin.id, username: admin.username, role: 'admin' },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({
            success: true,
            message: 'Login successful',
            token: token
        });
    } catch (err) {
        console.error('Database error during admin login:', err);
        res.status(500).json({ error: 'Database error during admin login.' });
    }
});

// 1. Setup Election Draft
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

// 2. Start Election ("Push GO")
app.post('/api/admin/start-election', async (req, res) => {
    const { electionId } = req.body;

    try {
        await db.query('UPDATE elections SET status = "closed"');
        await db.query('UPDATE elections SET status = "active" WHERE election_id = ?', [electionId]);
        await db.query('UPDATE voter_identity SET has_voted = 0');

        res.json({ success: true, message: `Election #${electionId} is now LIVE for voting!` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to activate election.' });
    }
});

// -------------------------------------------------------------------
// STUDENT / VOTER API ENDPOINTS
// -------------------------------------------------------------------

// 1. Student Login
app.post('/api/auth', async (req, res) => {
    const { university_id, otp } = req.body;

    try {
        const [rows] = await db.query('SELECT * FROM voter_identity WHERE university_id = ?', [university_id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Invalid University ID.' });

        const student = rows[0];
        if (student.otp_code !== otp) return res.status(401).json({ error: 'Invalid OTP code.' });
        if (student.has_voted === 1) return res.status(403).json({ error: 'Security Alert: You have already voted.' });

        const token = jwt.sign(
            { universityId: student.university_id, authorized: true },
            JWT_SECRET,
            { expiresIn: '30m' }
        );

        res.json({ message: 'Login successful.', token });
    } catch (err) {
        res.status(500).json({ error: 'Authentication failed.' });
    }
});

// 2. Get Active Election
app.get('/api/election/active', async (req, res) => {
    try {
        const [elections] = await db.query('SELECT * FROM elections WHERE status = "active" LIMIT 1');
        if (elections.length === 0) {
            return res.status(404).json({ error: 'No active election found at this time.' });
        }

        const activeElection = elections[0];
        const [categories] = await db.query('SELECT * FROM categories WHERE election_id = ?', [activeElection.election_id]);

        for (let cat of categories) {
            const [cands] = await db.query('SELECT candidate_id, candidate_name, party FROM candidates WHERE category_id = ?', [cat.category_id]);
            cat.candidates = cands;
        }

        res.json({
            electionId: activeElection.election_id,
            title: activeElection.title,
            categories
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve active election ballot.' });
    }
});

// 3. Cast Vote
app.post('/api/vote', verifyVotingToken, async (req, res) => {
    const { electionId, votes } = req.body; 
    const { universityId } = req.voterSession;

    if (!votes || !Array.isArray(votes) || votes.length === 0) {
        return res.status(400).json({ error: 'Invalid ballot submission.' });
    }

    try {
        const [elec] = await db.query('SELECT status FROM elections WHERE election_id = ?', [electionId]);
        if (elec.length === 0 || elec[0].status !== 'active') {
            return res.status(400).json({ error: 'Election is closed or inactive.' });
        }

        const [voter] = await db.query('SELECT has_voted FROM voter_identity WHERE university_id = ?', [universityId]);
        if (voter[0].has_voted === 1) {
            return res.status(403).json({ error: 'You have already submitted your ballot.' });
        }

        // Mark student status as voted first
        await db.query('UPDATE voter_identity SET has_voted = 1 WHERE university_id = ?', [universityId]);

        // Insert unlinked choice into ballot_box
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