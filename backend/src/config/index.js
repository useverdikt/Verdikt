"use strict";

const path = require("path");
const fs = require("fs");

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD_LIKE = NODE_ENV === "production" || process.env.REQUIRE_SECURE_CONFIG === "1";

const PORT = process.env.PORT || 8787;
const DEFAULT_JWT_SECRET = "dev-insecure-change-with-env-JWT_SECRET";
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
/** Local dev default; must match `openssl ... -hmac "${WEBHOOK_SECRET:-dev-webhook-secret}"` in scripts/test-e2e.sh */
const DEFAULT_DEV_WEBHOOK_SECRET = "dev-webhook-secret";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || (IS_PROD_LIKE ? "" : DEFAULT_DEV_WEBHOOK_SECRET);
/** Optional legacy global HMAC secret; still accepted after per-workspace inbound secrets exist. */
const WEBHOOK_FALLBACK_SECRET = (process.env.WEBHOOK_FALLBACK_SECRET || "").trim();
const ENCRYPTION_MASTER_KEY_RAW = (process.env.ENCRYPTION_MASTER_KEY || "").trim();

/** Minimum lengths when NODE_ENV=production or REQUIRE_SECURE_CONFIG=1 */
const MIN_JWT_SECRET_LEN = 32;
const MIN_WEBHOOK_SECRET_LEN = 24;
const BCRYPT_ROUNDS = 10;
const LOGIN_RATE_LIMIT_PER_MINUTE = Math.max(1, Number(process.env.LOGIN_RATE_LIMIT_PER_MINUTE || 12));
const ENABLE_THRESHOLD_SUGGESTIONS = process.env.ENABLE_THRESHOLD_SUGGESTIONS !== "0";
const ENABLE_THRESHOLD_SUGGESTIONS_LLM = process.env.ENABLE_THRESHOLD_SUGGESTIONS_LLM === "1";
const ENABLE_OVERRIDE_RISK_NOTE = process.env.ENABLE_OVERRIDE_RISK_NOTE === "1";
const ENABLE_ASSISTIVE_LLM = process.env.ENABLE_ASSISTIVE_LLM === "1";
const AI_CALL_TIMEOUT_MS = Number(process.env.AI_CALL_TIMEOUT_MS || 3500);
const AI_CALL_RETRIES = Math.max(0, Number(process.env.AI_CALL_RETRIES || 1));
const AI_PROVIDER = String(process.env.AI_PROVIDER || "gemini").toLowerCase();
const AI_MODEL =
  process.env.AI_MODEL ||
  (AI_PROVIDER === "gemini" ? "gemini-2.0-flash" : "claude-3-5-haiku-latest");
const AI_PROVIDER_API_KEY =
  AI_PROVIDER === "gemini" ? process.env.GEMINI_API_KEY || "" : process.env.ANTHROPIC_API_KEY || "";
const sharedPkg = require(path.join(__dirname, "..", "..", "..", "shared", "config.js"));
const DEFAULT_COLLECTION_WINDOW_MINUTES = sharedPkg.defaultCollectionWindowMinutes;
const WEBHOOK_RATE_LIMIT_PER_MINUTE = Number(process.env.WEBHOOK_RATE_LIMIT_PER_MINUTE || 120);
const ALLOWED_RELEASE_TYPES = sharedPkg.getAllowedReleaseTypesSet();
const AI_SIGNAL_IDS = sharedPkg.aiSignalIds;
const AI_SIGNAL_DEFINITIONS = sharedPkg.aiSignalDefinitions;
const SIGNAL_ALIAS_MAP = sharedPkg.signalAliasMap;

/** HttpOnly session cookie name (JWT). CSRF uses a separate readable cookie + X-CSRF-Token header. */
const AUTH_COOKIE_NAME = (process.env.AUTH_COOKIE_NAME || "vdk_auth").trim() || "vdk_auth";
const CSRF_COOKIE_NAME = (process.env.CSRF_COOKIE_NAME || "vdk_csrf").trim() || "vdk_csrf";
const COOKIE_MAX_AGE_MS = Math.max(60_000, Number(process.env.AUTH_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000));
/** Optional `redis://` URL for distributed rate limits (multi-instance). When unset, in-memory maps are used. */
const REDIS_URL = (process.env.REDIS_URL || "").trim();

/** Supabase Dashboard → Settings → API → JWT Secret (session exchange + optional future use). */
const SUPABASE_JWT_SECRET = (process.env.SUPABASE_JWT_SECRET || "").trim();

/** When false, POST /api/auth/register returns 403 (design-partner / invite-only phase). */
const ALLOW_PUBLIC_REGISTRATION = (() => {
  const raw = process.env.ALLOW_PUBLIC_REGISTRATION;
  if (raw === "1" || String(raw).toLowerCase() === "true") return true;
  if (raw === "0" || String(raw).toLowerCase() === "false") return false;
  return !IS_PROD_LIKE;
})();

if (IS_PROD_LIKE && JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error("Refusing to start with default JWT_SECRET in production-like mode.");
}
if (IS_PROD_LIKE && (!WEBHOOK_SECRET || !String(WEBHOOK_SECRET).trim())) {
  throw new Error("Refusing to start without WEBHOOK_SECRET in production-like mode.");
}
if (IS_PROD_LIKE && JWT_SECRET.length < MIN_JWT_SECRET_LEN) {
  throw new Error(
    `Refusing to start: JWT_SECRET must be at least ${MIN_JWT_SECRET_LEN} characters in production-like mode (use openssl rand -hex 32 or similar).`
  );
}
if (IS_PROD_LIKE && WEBHOOK_SECRET.length < MIN_WEBHOOK_SECRET_LEN) {
  throw new Error(
    `Refusing to start: WEBHOOK_SECRET must be at least ${MIN_WEBHOOK_SECRET_LEN} characters in production-like mode.`
  );
}
if (IS_PROD_LIKE) {
  const hex = ENCRYPTION_MASTER_KEY_RAW.startsWith("0x")
    ? ENCRYPTION_MASTER_KEY_RAW.slice(2)
    : ENCRYPTION_MASTER_KEY_RAW;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY is required in production-like mode: 64 hex characters (32 bytes) for AES-256-GCM at-rest encryption."
    );
  }
}
if (!IS_PROD_LIKE && JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.warn("WARNING: Using default JWT_SECRET in non-production mode.");
}
if (!IS_PROD_LIKE && !process.env.WEBHOOK_SECRET) {
  console.warn(
    "WARNING: WEBHOOK_SECRET not set in env; using local default (dev-webhook-secret). Matches npm run test:e2e signing."
  );
}
if (IS_PROD_LIKE && !ALLOW_PUBLIC_REGISTRATION) {
  console.warn(
    "INFO: Public self-service registration is OFF (ALLOW_PUBLIC_REGISTRATION unset or 0). Provision accounts with: npm run provision:user (see backend/README.md)."
  );
}

module.exports = {
  IS_PROD_LIKE,
  ALLOW_PUBLIC_REGISTRATION,
  PORT,
  DEFAULT_JWT_SECRET,
  JWT_SECRET,
  WEBHOOK_SECRET,
  WEBHOOK_FALLBACK_SECRET,
  BCRYPT_ROUNDS,
  LOGIN_RATE_LIMIT_PER_MINUTE,
  ENABLE_THRESHOLD_SUGGESTIONS,
  ENABLE_THRESHOLD_SUGGESTIONS_LLM,
  ENABLE_OVERRIDE_RISK_NOTE,
  ENABLE_ASSISTIVE_LLM,
  AI_CALL_TIMEOUT_MS,
  AI_CALL_RETRIES,
  AI_PROVIDER,
  AI_MODEL,
  AI_PROVIDER_API_KEY,
  DEFAULT_COLLECTION_WINDOW_MINUTES,
  WEBHOOK_RATE_LIMIT_PER_MINUTE,
  ALLOWED_RELEASE_TYPES,
  AI_SIGNAL_IDS,
  AI_SIGNAL_DEFINITIONS,
  SIGNAL_ALIAS_MAP,
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  COOKIE_MAX_AGE_MS,
  REDIS_URL,
  SUPABASE_JWT_SECRET,
  ENCRYPTION_MASTER_KEY: ENCRYPTION_MASTER_KEY_RAW
};
