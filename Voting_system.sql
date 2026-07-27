-- 1. Elections Table
CREATE TABLE IF NOT EXISTS elections (
    election_id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    status ENUM('draft', 'active', 'closed') DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Categories Table (Positions like President, Secretary)
CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    election_id INT NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    FOREIGN KEY (election_id) REFERENCES elections(election_id) ON DELETE CASCADE
);

-- 3. Candidates Table
CREATE TABLE IF NOT EXISTS candidates (
    candidate_id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    candidate_name VARCHAR(100) NOT NULL,
    party VARCHAR(100) DEFAULT '',
    FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE CASCADE
);

-- 4. Voter Identity Table
CREATE TABLE IF NOT EXISTS voter_identity (
    university_id VARCHAR(20) PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    has_voted TINYINT(1) DEFAULT 0
);

-- 5. Ballot Box Table (Decoupled to preserve voter anonymity)
CREATE TABLE IF NOT EXISTS ballot_box (
    vote_id VARCHAR(36) PRIMARY KEY,
    election_id INT NOT NULL,
    category_id INT NOT NULL,
    candidate_id INT NOT NULL,
    vote_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed Sample Student Test Accounts
INSERT INTO voter_identity (university_id, full_name, otp_code, has_voted) VALUES
('UNI-2026-001', 'Alex Smith', '123456', 0),
('UNI-2026-002', 'Jordan Lee', '654321', 0)
ON DUPLICATE KEY UPDATE university_id=university_id;

-- 1. Create the admins table
CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Insert a default admin account (Username: admin, Password: adminpassword123)
INSERT INTO `admins` (`username`, `password`) 
VALUES ('admin', 'admin123')
ON DUPLICATE KEY UPDATE `username`=`username`;