// Shared helpers for the student portal's secondary pages (profile,
// voting history, change password). index.html keeps its own
// bootstrap logic since it also has to handle the logged-out state
// (login/register forms); these pages assume a voter is already
// logged in and just need the nav bar + the usual auth plumbing.

// Redirects to the login page immediately if no voter token is
// saved. This is a client-side convenience only, not a real guard ~
// same lightweight pattern admin.html uses. An expired or invalid
// token is caught for real the first time this page calls a
// protected API and gets a 401/403 back (see handleAuthFailure).
function requireVoterAuth() {
    const token = localStorage.getItem('voterToken');
    if (!token) {
        window.location.href = '/';
    }
    return token;
}

function studentAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('voterToken')}`
    };
}

// Clears both voter and admin sessions ~ same reasoning as index.html's
// clearAllSessions(): a token failing auth in one portal shouldn't
// leave a stale session usable in the other.
function handleAuthFailure(res) {
    if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('voterToken');
        localStorage.removeItem('adminToken');
        window.location.href = '/';
        return true;
    }
    return false;
}

function logoutStudent() {
    localStorage.removeItem('voterToken');
    localStorage.removeItem('adminToken');
    window.location.href = '/';
}

// Every page-controlled value that gets written into innerHTML goes
// through this first ~ same escaping rule as index.html and admin.html.
function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
}

// Decodes the voter JWT's payload client-side (unverified ~ just for
// reading the universityId claim to scope localStorage keys). Never
// used for anything security-relevant; every real check happens
// server-side against the signed token via verifyVotingToken.
function getVoterUniversityId() {
    const token = localStorage.getItem('voterToken');
    if (!token) return null;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.universityId || null;
    } catch (e) {
        return null;
    }
}

// Reads back the receipt hashes saved locally at the moment a ballot
// was cast for a given election (see index.html's submitVote()).
// Returns null if nothing was saved for it ~ e.g. the vote was cast
// on a different device/browser, or local storage was cleared since.
//
// This exists because ballot_box is deliberately never linked back to
// university_id (see Voting_system.sql) ~ the server can confirm a
// student voted in an election (election_votes) but has no way to
// hand back which receipt hash(es) belonged to them without breaking
// that anonymity. The receipts are shown to the student once, right
// when they cast their vote, and it's on their own browser to hold
// onto them after that.
function getLocalReceipts(electionId) {
    const uid = getVoterUniversityId();
    if (!uid) return null;
    try {
        const store = JSON.parse(localStorage.getItem(`voteReceipts:${uid}`) || '{}');
        return store[electionId] || null;
    } catch (e) {
        return null;
    }
}

// Renders the shared top nav into a <div id="studentNav"></div> that
// must already exist in the page, highlighting whichever page is
// current. Kept as one function (instead of copy-pasted markup in
// four files) so adding or renaming a page only means an edit here.
function renderStudentNav(activePage) {
    const pages = [
        { key: 'dashboard', href: '/', label: 'Elections' },
        { key: 'profile', href: '/profile.html', label: 'Profile' },
        { key: 'history', href: '/voting-history.html', label: 'Voting History' },
        { key: 'password', href: '/change-password.html', label: 'Change Password' },
    ];

    const nav = document.getElementById('studentNav');
    if (!nav) return;

    nav.innerHTML = `
        <div class="header-bar">
            <div class="student-nav-links">
                ${pages.map(p => `<a href="${p.href}" class="student-nav-link${p.key === activePage ? ' active' : ''}">${p.label}</a>`).join('')}
            </div>
            <button onclick="logoutStudent()" class="btn btn-danger">Logout</button>
        </div>
    `;
}
