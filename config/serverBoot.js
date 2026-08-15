const crypto = require("crypto");

/**
 * A fresh random ID generated exactly once per process start (npm start /
 * node server.js). Every JWT this server issues, admin or voter, carries
 * this value as a "bootId" claim, and every auth check compares it against
 * the current process's SERVER_BOOT_ID.
 *
 * Why: JWT_SECRET lives in .env and doesn't change between restarts, so
 * without this a token issued before the server was closed would still be
 * cryptographically valid after it's started back up ~ a stale browser tab,
 * or anyone who managed to grab an old token, could keep using it against a
 * freshly restarted server. Tying every token to the current boot ID means
 * closing and restarting the server (from the cmd window, npm start, a
 * crash recovery, etc.) immediately invalidates every session that existed
 * before the restart, admin and student alike, forcing a fresh login.
 */
const SERVER_BOOT_ID = crypto.randomUUID();

module.exports = { SERVER_BOOT_ID };
