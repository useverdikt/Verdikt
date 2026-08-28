"use strict";

/**
 * PostgreSQL pool. DATABASE_URL is required (no SQLite fallback).
 */
const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");

const SUPABASE_CA_PATH = path.join(__dirname, "certs", "supabase-root-2021.crt");
const SSL_QUERY_KEYS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "ssl"];

/** Keep ISO string timestamps for migrated TIMESTAMPTZ columns (TEXT-era callers). */
function parseTimestamp(val) {
  if (val == null) return null;
  return new Date(val).toISOString();
}
types.setTypeParser(1184, parseTimestamp);
types.setTypeParser(1187, parseTimestamp);

let pool;
let bundledSupabaseCa;

function isSupabaseConnection(connectionString) {
  return /supabase\.co|\.pooler\.supabase/i.test(connectionString || "");
}

function shouldUseSsl(connectionString) {
  if (process.env.DATABASE_SSL === "0") return false;
  if (process.env.DATABASE_SSL === "1") return true;
  return isSupabaseConnection(connectionString);
}

function isProdLikeSslGuard() {
  return process.env.NODE_ENV === "production" || process.env.REQUIRE_SECURE_CONFIG === "1";
}

/** TLS certificate validation is on by default. Opt out only in non-prod with DATABASE_SSL_REJECT_UNAUTHORIZED=0. */
function sslRejectUnauthorized() {
  return process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "0";
}

function normalizePem(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (s.includes("\\n") && !s.includes("\n")) s = s.replace(/\\n/g, "\n");
  return s;
}

function readBundledSupabaseCa() {
  if (bundledSupabaseCa === undefined) {
    try {
      bundledSupabaseCa = fs.readFileSync(SUPABASE_CA_PATH, "utf8");
    } catch {
      bundledSupabaseCa = "";
    }
  }
  return bundledSupabaseCa;
}

/**
 * CA PEM used to verify the server cert. Precedence: DATABASE_SSL_CA, DATABASE_SSL_CA_FILE,
 * then the official Supabase Root 2021 CA for Supabase hosts.
 */
function loadSslCa(connectionString) {
  const fromEnv = normalizePem(process.env.DATABASE_SSL_CA);
  if (fromEnv) return fromEnv;
  const file = String(process.env.DATABASE_SSL_CA_FILE || "").trim();
  if (file) return fs.readFileSync(file, "utf8");
  if (isSupabaseConnection(connectionString)) return readBundledSupabaseCa();
  return "";
}

/**
 * node-postgres parses sslmode from the URL and can discard an explicit `ssl` object.
 * Keep TLS in `ssl` only.
 */
function stripSslQueryParams(connectionString) {
  const raw = String(connectionString || "");
  const qIndex = raw.indexOf("?");
  if (qIndex < 0) return raw;
  const base = raw.slice(0, qIndex);
  const params = new URLSearchParams(raw.slice(qIndex + 1));
  for (const key of SSL_QUERY_KEYS) params.delete(key);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function sslConfig(connectionString) {
  if (!shouldUseSsl(connectionString)) return undefined;
  const rejectUnauthorized = sslRejectUnauthorized();
  if (!rejectUnauthorized && isProdLikeSslGuard()) {
    throw new Error(
      "Refusing to start: DATABASE_SSL_REJECT_UNAUTHORIZED=0 is not allowed in production-like mode."
    );
  }
  const cfg = { rejectUnauthorized };
  const ca = loadSslCa(connectionString);
  if (ca) cfg.ca = ca;
  return cfg;
}

function annotateDatabaseSslError(error) {
  const code = error && error.code;
  const msg = String((error && error.message) || "");
  if (code !== "SELF_SIGNED_CERT_IN_CHAIN" && !/self-signed certificate/i.test(msg)) {
    return error;
  }
  const wrapped = new Error(
    `${msg}. Postgres presented a certificate that is not in Node's default CA list ` +
      "(common with Supabase). For Supabase hosts Verdikt trusts the official Root 2021 CA automatically. " +
      "For other providers set DATABASE_SSL_CA to the PEM from your host. " +
      "Do not set DATABASE_SSL_REJECT_UNAUTHORIZED=0 in production."
  );
  wrapped.code = code;
  wrapped.cause = error;
  return wrapped;
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
      connectionString: stripSslQueryParams(url),
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

module.exports = {
  getPool,
  closePool,
  shouldUseSsl,
  sslConfig,
  stripSslQueryParams,
  loadSslCa,
  annotateDatabaseSslError
};
