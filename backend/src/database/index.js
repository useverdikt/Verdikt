"use strict";

const { runMigrations } = require("./runMigrations");
const query = require("./query");

/**
 * Connects to PostgreSQL and applies pending migrations. Call once at process startup (and in tests).
 */
async function initDatabase() {
  await runMigrations();
}

module.exports = {
  initDatabase,
  queryOne: query.queryOne,
  queryAll: query.queryAll,
  run: query.run,
  transaction: query.transaction,
  query: query.query,
  toPg: query.toPg,
  closePool: query.closePool
};
