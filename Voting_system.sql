-- =========================================================
-- Secure Online Voting System ~ unified schema
-- =========================================================

CREATE DATABASE IF NOT EXISTS voting_system;
USE voting_system;

-- ---------------------------------------------------------
-- Elections
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS elections (
    election_id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    status ENUM('draft', 'active', 'closed') DEFAULT 'draft',
    ends_at DATETIME DEFAULT NULL,
    started_at DATETIME DEFAULT NULL,
    ended_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------
-- Categories (e.g. President, Secretary)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    election_id INT NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    FOREIGN KEY (election_id) REFERENCES elections(election_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- Candidates
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidates (
    candidate_id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    candidate_name VARCHAR(100) NOT NULL,
    party VARCHAR(100) DEFAULT '',
    FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- Voter identity ~ real self-registration table:
--   register -> emailed OTP -> verify -> login with password
-- Passwords are bcrypt hashes, never plain text.
--
-- NOTE: has_voted is legacy and no longer written to by the
-- app (kept only so existing rows/columns aren't destroyed).
-- Per-election vote status now lives in election_votes below,
-- because with multiple elections able to run at the same
-- time, a single global flag on this table can't tell you
-- whether a student has voted in *this* election.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS voter_identity (
    university_id VARCHAR(20) PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    is_verified TINYINT(1) DEFAULT 0,
    otp VARCHAR(6) DEFAULT NULL,
    otp_expires_at DATETIME DEFAULT NULL,
    has_voted TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------
-- Per-election vote status.
--
-- One row means "this student has cast a ballot in this
-- specific election." It does not contain the candidate
-- selected by the student.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS election_votes (
    university_id VARCHAR(20) NOT NULL,
    election_id INT NOT NULL,
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (university_id, election_id),
    FOREIGN KEY (university_id) REFERENCES voter_identity(university_id) ON DELETE CASCADE,
    FOREIGN KEY (election_id) REFERENCES elections(election_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------
-- Ballot box ~ deliberately NOT linked to university_id,
-- so a cast vote is not directly tied to a voter identity.
-- The application records participation in election_votes
-- and the anonymous ballot here in the same transaction.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS ballot_box (
    vote_id VARCHAR(36) PRIMARY KEY,
    election_id INT NOT NULL,
    category_id INT NOT NULL,
    candidate_id INT NOT NULL,
    vote_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------
-- Admins ~ password is a bcrypt hash. A default admin is
-- auto-seeded on first server start from .env (see server.js
-- / config/seedAdmin.js), so the schema file never contains
-- a real credential.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);