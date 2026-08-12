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
 * All pending files execute in one transaction so the transaction-scoped
 * advisory lock remains pinned to one PostgreSQL backend even through a
 * transaction-pooling proxy such as Supavisor.
 */
async function runMigrations({
  pool = getPool(),
  fsImpl = fs,
  migrationsDir = MIGRATIONS_DIR,
  nowFn = nowIso,
  logger = console
} = {}) {
  const client = await pool.connect();
  let transactionOpen = false;
  let destroyClient = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", MIGRATION_LOCK_KEYS);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);

    const { rows: appliedRows } = await client.query("SELECT name FROM schema_migrations");
    const applied = new Set(appliedRows.map((r) => r.name));
    const newlyApplied = [];

    let files = [];
    if (!fsImpl.existsSync(migrationsDir)) {
      logger.warn("[migrations] directory missing:", migrationsDir);
    } else {
      files = fsImpl
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
    }

    for (const file of files) {
      const base = file.replace(/\.sql$/, "");
      if (applied.has(base)) continue;

      const full = path.join(migrationsDir, file);
      const sql = fsImpl.readFileSync(full, "utf8");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [
          base,
          nowFn()
        ]);
        newlyApplied.push(base);
      } catch (e) {
        throw new Error(`Migration ${file} failed: ${e.message}`);
      }
    }
    await client.query("COMMIT");
    transactionOpen = false;
    for (const base of newlyApplied) logger.log("[migrations] applied:", base);
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
        transactionOpen = false;
      } catch {
        destroyClient = true;
      }
    }
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

module.exports = { MIGRATION_LOCK_KEYS, runMigrations };
