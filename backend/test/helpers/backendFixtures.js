"use strict";

/**
 * Shared setup and helpers for backend integration/unit tests.
 * Load this first so env vars are set before importing app/config modules.
 */

const crypto = require("crypto");

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.GITHUB_WEBHOOK_SECRET = "test-github-webhook-secret-32-min";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";
process.env.INTERNAL_WORKSPACE_VIEWER_EMAILS = "@internal.test";
process.env.ENABLE_ASSISTIVE_LLM = "1";

const GEMINI_STUB = "unit-test-stub-gemini-key-not-for-production-use";
if (process.env.GEMINI_LIVE_TEST !== "1") {
  process.env.GEMINI_LIVE_TEST = "0";
  process.env.GEMINI_API_KEY = GEMINI_STUB;
} else if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = GEMINI_STUB;
}

const { before } = require("node:test");
const { initDatabase, queryOne, run } = require("../../src/database");
const { createApp } = require("../../src/app");
const { ensureWorkspaceSeeded } = require("../../src/services/domain");
const { writeAudit } = require("../../src/services/audit");
const sharedPkg = require("../../src/lib/sharedPkg");

let dbReady = false;
before(async () => {
  if (dbReady) return;
  await initDatabase();
  dbReady = true;
});

/** Seed full default threshold rows for unit tests that exercise verdict/delta logic. */
async function seedDefaultThresholdsForTest(workspaceId) {
  await ensureWorkspaceSeeded(workspaceId);
  const countRow = await queryOne("SELECT COUNT(*) AS c FROM thresholds WHERE workspace_id = $1", [workspaceId]);
  if (Number(countRow?.c || 0) > 0) return;
  const defaults = sharedPkg.getDefaultThresholdSeedRows();
  const defaultRequired = new Set(sharedPkg.defaultRequiredSignalIds || []);
  const insertSql =
    "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification) VALUES ($1, $2, $3, $4, $5)";
  for (const row of defaults) {
    await run(insertSql, [workspaceId, row[0], row[1], row[2], defaultRequired.has(row[0]) ? 1 : 0]);
  }
}

async function setUserRole(userId, workspaceId, role) {
  await run("UPDATE users SET role = $1 WHERE id = $2", [role, userId]);
  await run("UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3", [
    role,
    workspaceId,
    userId
  ]);
}

function signGithubPayload(payload) {
  const raw = JSON.stringify(payload);
  const sig = crypto
    .createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET)
    .update(raw)
    .digest("hex");
  return { raw, sig: `sha256=${sig}` };
}

async function waitForAuditEvent(releaseId, eventType, { timeoutMs = 5000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await queryOne(
      "SELECT * FROM audit_events WHERE release_id = $1 AND event_type = $2 ORDER BY id DESC LIMIT 1",
      [releaseId, eventType]
    );
    if (row) return row;
    await new Promise((r) => setTimeout(r, 30));
  }
  return null;
}

async function waitForAuditEventCount(releaseId, eventType, minCount, { timeoutMs = 8000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await queryOne(
      "SELECT COUNT(*) AS c FROM audit_events WHERE release_id = $1 AND event_type = $2",
      [releaseId, eventType]
    );
    if (Number(row?.c || 0) >= minCount) return Number(row.c);
    await new Promise((r) => setTimeout(r, 50));
  }
  const row = await queryOne(
    "SELECT COUNT(*) AS c FROM audit_events WHERE release_id = $1 AND event_type = $2",
    [releaseId, eventType]
  );
  return Number(row?.c || 0);
}

module.exports = {
  GEMINI_STUB,
  createApp,
  ensureWorkspaceSeeded,
  writeAudit,
  seedDefaultThresholdsForTest,
  setUserRole,
  signGithubPayload,
  waitForAuditEvent,
  waitForAuditEventCount
};
