"use strict";

/**
 * PostgreSQL pool. DATABASE_URL is required (no SQLite fallback).
 */
const { Pool, types } = require("pg");

/** Keep ISO string timestamps for migrated TIMESTAMPTZ columns (TEXT-era callers). */
function parseTimestamp(val) {
  if (val == null) return null;
  return new Date(val).toISOString();
}
types.setTypeParser(1184, parseTimestamp);
types.setTypeParser(1187, parseTimestamp);

let pool;

function shouldUseSsl(connectionString) {
  if (process.env.DATABASE_SSL === "0") return false;
  if (process.env.DATABASE_SSL === "1") return true;
  return /supabase\.co|\.pooler\.supabase/i.test(connectionString || "");
}

function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) {
    throw new Error(
      "DATABASE_URL is required. Set it to a PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/dbname). SQLite is no longer supported."
    );
  }
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX || 10),
      ssl: shouldUseSsl(url) ? { rejectUnauthorized: false } : undefined
    });
  }
  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, closePool };
