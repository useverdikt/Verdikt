"use strict";

const fs = require("fs");
const path = require("path");
const { getPool } = require("../db/pg");
const { nowIso } = require("../lib/time");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations", "postgres");
const MIGRATION_LOCK_KEYS = [1447316308, 1296648018]; // "VDKT", "MIGR"

/**
 * Runs ordered *.sql migrations from backend/migrations/postgres.
 * Tracked in schema_migrations; each file runs at most once.
 *
 * Each migration file executes inside a single BEGIN/COMMIT on one connection,
 * so multi-statement files (e.g. backfill + trigger) are atomic.
 */
async function runMigrations({
  pool = getPool(),
  fsImpl = fs,
  migrationsDir = MIGRATIONS_DIR,
  nowFn = nowIso,
  logger = console
} = {}) {
  const client = await pool.connect();
  let lockAcquired = false;
  let destroyClient = false;
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", MIGRATION_LOCK_KEYS);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);

    const { rows: appliedRows } = await client.query("SELECT name FROM schema_migrations");
    const applied = new Set(appliedRows.map((r) => r.name));

    if (!fsImpl.existsSync(migrationsDir)) {
      logger.warn("[migrations] directory missing:", migrationsDir);
      return;
    }

    const files = fsImpl
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const base = file.replace(/\.sql$/, "");
      if (applied.has(base)) continue;

      const full = path.join(migrationsDir, file);
      const sql = fsImpl.readFileSync(full, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [
          base,
          nowFn()
        ]);
        await client.query("COMMIT");
        logger.log("[migrations] applied:", base);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${e.message}`);
      }
    }
  } finally {
    if (lockAcquired) {
      try {
        const result = await client.query(
          "SELECT pg_advisory_unlock($1, $2) AS unlocked",
          MIGRATION_LOCK_KEYS
        );
        if (result.rows?.[0]?.unlocked !== true) destroyClient = true;
      } catch {
        destroyClient = true;
      }
    }
    client.release(destroyClient);
  }
}

module.exports = { MIGRATION_LOCK_KEYS, runMigrations };
