"use strict";

const fs = require("fs");
const path = require("path");
const { getPool } = require("../db/pg");
const { nowIso } = require("../lib/time");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations", "postgres");

/**
 * Runs ordered *.sql migrations from backend/migrations/postgres.
 * Tracked in schema_migrations; each file runs at most once.
 */
async function runMigrations() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);

    const { rows: appliedRows } = await client.query("SELECT name FROM schema_migrations");
    const applied = new Set(appliedRows.map((r) => r.name));

    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.warn("[migrations] directory missing:", MIGRATIONS_DIR);
      return;
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const base = file.replace(/\.sql$/, "");
      if (applied.has(base)) continue;

      const full = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(full, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [base, nowIso()]);
        await client.query("COMMIT");
        console.log("[migrations] applied:", base);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${e.message}`);
      }
    }
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
