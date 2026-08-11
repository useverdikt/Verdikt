"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const BACKEND_DIR = path.resolve(__dirname, "..");
const BASE_ENV = {
  NODE_ENV: "production",
  JWT_SECRET: "jwt-secret-independent-32-characters-minimum",
  CERT_SIGNING_KEY: "cert-signing-independent-32-characters-minimum",
  WEBHOOK_SECRET: "webhook-secret-24-characters-minimum",
  ENCRYPTION_MASTER_KEY: "ab".repeat(32),
  CORS_ORIGINS: "https://app.example.com",
  DATABASE_URL: "postgresql://example.invalid/verdikt"
};

function loadConfig(extraEnv = {}) {
  const env = { ...process.env, ...BASE_ENV, ...extraEnv };
  for (const key of [
    "API_REPLICA_COUNT",
    "REQUIRE_DISTRIBUTED_RATE_LIMITS",
    "REDIS_URL",
    "INTERNAL_WORKSPACE_VIEWER_EMAILS",
    "OUTBOX_MODE"
  ]) {
    if (!(key in extraEnv)) delete env[key];
  }
  return spawnSync(process.execPath, ["-e", "require('./src/config')"], {
    cwd: BACKEND_DIR,
    env,
    encoding: "utf8"
  });
}

describe("production secure configuration", () => {
  it("accepts independent signing key for a single API replica", () => {
    const out = loadConfig();
    assert.equal(out.status, 0, out.stderr);
  });

  it("rejects internal cross-workspace viewers", () => {
    const out = loadConfig({ INTERNAL_WORKSPACE_VIEWER_EMAILS: "@example.com" });
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /INTERNAL_WORKSPACE_VIEWER_EMAILS must be empty/);
  });

  it("requires Redis for multiple API replicas", () => {
    const out = loadConfig({ API_REPLICA_COUNT: "2" });
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /Refusing to start without REDIS_URL/);
  });

  it("accepts Redis-backed multi-replica rate limits", () => {
    const out = loadConfig({ API_REPLICA_COUNT: "2", REDIS_URL: "redis://redis.example.invalid:6379" });
    assert.equal(out.status, 0, out.stderr);
  });

  it("rejects reuse of the JWT secret for certificate signing", () => {
    const out = loadConfig({ CERT_SIGNING_KEY: BASE_ENV.JWT_SECRET });
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /CERT_SIGNING_KEY must be independent/);
  });

  it("rejects outbox delivery modes that are not implemented yet", () => {
    const out = loadConfig({ OUTBOX_MODE: "primary" });
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /OUTBOX_MODE must be off or shadow/);
  });
});
