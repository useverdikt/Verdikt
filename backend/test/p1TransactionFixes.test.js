"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";

const crypto = require("crypto");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { initDatabase, run, queryOne, queryAll } = require("../src/database");
const { ensureWorkspaceSeeded, evaluateReleaseAfterSignalIngest } = require("../src/services/domain");
const { openReleaseSession } = require("../src/services/releaseIdentity");
const { applyPulledSignals } = require("../src/services/signalIngestFromSources");
const { nowIso } = require("../src/lib/time");

before(async () => {
  await initDatabase();
});

describe("openReleaseSession idempotency transaction", () => {
  it("concurrent opens with the same identity key create only one release", async () => {
    const wsId = `ws_open_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(wsId);
    const sha = crypto.randomBytes(20).toString("hex");
    const key = `release:${wsId}:useverdikt/verdikt:pr:42:sha:${sha}`;

    const params = {
      workspaceId: wsId,
      version: "v-concurrent",
      releaseRef: "v-concurrent",
      releaseType: "model_update",
      environment: "staging",
      source: "test",
      idempotencyKey: key,
      commitSha: sha,
      prNumber: 42,
      githubOwner: "useverdikt",
      githubRepo: "verdikt"
    };

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => openReleaseSession(params))
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    assert.ok(fulfilled.length >= 1, "at least one open should succeed");

    const releaseIds = new Set(fulfilled.map((r) => r.release?.id).filter(Boolean));
    assert.equal(releaseIds.size, 1, `expected one release id, got ${[...releaseIds].join(",")}`);

    const rows = await queryAll(
      `SELECT r.id FROM releases r
       JOIN webhook_events w ON w.release_id = r.id
       WHERE w.idempotency_key = $1`,
      [key]
    );
    assert.equal(rows.length, 1, `expected one release row for key, got ${rows.length}`);
  });
});

describe("applyPulledSignals atomic delete+insert", () => {
  it("replaces prior pulled signals for the same source in one transaction", async () => {
    const wsId = `ws_pull_${crypto.randomBytes(4).toString("hex")}`;
    const releaseId = `rel_pull_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(wsId);
    const ts = nowIso();
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [releaseId, wsId, "v1", "model_update", "staging", "COLLECTING", ts, ts]
    );

    const sourceTag = "integration:braintrust";
    await applyPulledSignals(releaseId, sourceTag, "v1", { accuracy: 88 }, "braintrust");
    await applyPulledSignals(releaseId, sourceTag, "v1", { accuracy: 92, latency: 120 }, "braintrust");

    const signals = await queryAll(
      "SELECT signal_id, value FROM signals WHERE release_id = $1 AND source = $2 ORDER BY signal_id",
      [releaseId, sourceTag]
    );
    assert.equal(signals.length, 2);
    const accuracy = signals.find((s) => s.signal_id === "accuracy");
    assert.equal(Number(accuracy.value), 92);
  });
});

describe("evaluateReleaseAfterSignalIngest row lock", () => {
  it("concurrent evaluations commit a single final status", async () => {
    const wsId = `ws_verdict_${crypto.randomBytes(4).toString("hex")}`;
    const releaseId = `rel_verdict_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(wsId);
    const ts = nowIso();
    const deadline = new Date(Date.now() - 60_000).toISOString();
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at, collection_deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [releaseId, wsId, "v1", "model_update", "staging", "COLLECTING", ts, ts, deadline]
    );

    await run(
      `INSERT INTO signals (release_id, signal_id, value, source, created_at)
       VALUES ($1, $2, $3, $4, $5), ($1, $6, $7, $4, $5), ($1, $8, $9, $4, $5)`,
      [releaseId, "accuracy", 95, "test", ts, "latency", 50, "error_rate", 0.1]
    );

    const release = await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => evaluateReleaseAfterSignalIngest(release, releaseId, "test", 3))
    );

    const committed = outcomes.filter(Boolean);
    assert.ok(committed.length >= 1, "at least one evaluation should commit");

    const finalRow = await queryOne("SELECT status FROM releases WHERE id = $1", [releaseId]);
    assert.ok(
      ["CERTIFIED", "UNCERTIFIED"].includes(finalRow.status),
      `unexpected final status ${finalRow.status}`
    );

    const verdictAudits = await queryAll(
      `SELECT id FROM audit_events WHERE release_id = $1 AND event_type = 'SIGNALS_INGESTED'
       AND details_json LIKE '%"computed_status":"CERTIFIED"%'
          OR details_json LIKE '%"computed_status":"UNCERTIFIED"%'`,
      [releaseId]
    );
    assert.ok(verdictAudits.length >= 1);
  });
});
