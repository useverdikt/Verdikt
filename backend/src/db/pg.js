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

function isProdLikeSslGuard() {
  return process.env.NODE_ENV === "production" || process.env.REQUIRE_SECURE_CONFIG === "1";
}

/** TLS certificate validation is on by default. Opt out only in non-prod with DATABASE_SSL_REJECT_UNAUTHORIZED=0. */
function sslRejectUnauthorized() {
  return process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "0";
}

function sslConfig(connectionString) {
  if (!shouldUseSsl(connectionString)) return undefined;
  const rejectUnauthorized = sslRejectUnauthorized();
  if (!rejectUnauthorized && isProdLikeSslGuard()) {
    throw new Error(
      "Refusing to start: DATABASE_SSL_REJECT_UNAUTHORIZED=0 is not allowed in production-like mode."
    );
  }
  return { rejectUnauthorized };
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
      ssl: sslConfig(url)
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

module.exports = { getPool, closePool, shouldUseSsl, sslConfig };
