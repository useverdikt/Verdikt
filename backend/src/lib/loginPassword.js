"use strict";

const bcrypt = require("bcrypt");
const { BCRYPT_ROUNDS } = require("../config");

/** Precomputed so missing-user logins still pay one bcrypt compare. */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("verdikt-login-timing-mitigation-placeholder", BCRYPT_ROUNDS);

/**
 * Always runs bcrypt.compare so unknown emails take similar time to known ones.
 * Succeeds only when a user row exists and the password matches its stored hash.
 */
async function authenticatePassword(password, userRow) {
  const hash = userRow?.password_hash || DUMMY_PASSWORD_HASH;
  const match = await bcrypt.compare(password, hash);
  return Boolean(userRow && match);
}

module.exports = { authenticatePassword, DUMMY_PASSWORD_HASH };
