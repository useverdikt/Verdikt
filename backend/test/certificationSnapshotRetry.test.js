"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.NODE_ENV = "test";

const { describe, it, before, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { initDatabase, run, queryOne } = require("../src/database");
const certificationSnapshots = require("../src/services/certificationSnapshots");
const {
  enqueueCertificationSnapshotPersist,
  processDueCertificationSnapshotRetries,
  _resetCertificationSnapshotRetryState,
  MAX_ATTEMPTS
} = require("../src/services/certificationSnapshotRetry");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { nowIso } = require("../src/lib/time");

before(async () => {
  await initDatabase();
});

afterEach(async () => {
  mock.restoreAll();
  await _resetCertificationSnapshotRetryState();
});

async function seedCertifiedRelease() {
  const ws = `ws_csr_${crypto.randomBytes(4).toString("hex")}`;
  const releaseId = `rel_csr_${crypto.randomBytes(4).toString("hex")}`;
  const ts = nowIso();
  await ensureWorkspaceSeeded(ws);
  await run(
    `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [releaseId, ws, "csr-v1", "model_update", "staging", "CERTIFIED", ts, ts]
  );
  return { ws, releaseId };
}

async function makeDue(releaseId) {
  await run(
    `UPDATE certification_snapshot_retries
        SET next_attempt_at = NOW() - interval '1 second'
      WHERE release_id = $1`,
    [releaseId]
  );
}

describe("certification snapshot durable retries", () => {
  it("enqueues a DB retry row when persist fails", async () => {
    const { ws, releaseId } = await seedCertifiedRelease();

    mock.method(certificationSnapshots, "persistCertificationSnapshot", async () => {
      throw new Error("simulated_persist_failure");
    });

    const out = await enqueueCertificationSnapshotPersist({
      releaseId,
      workspaceId: ws,
      thresholdMap: { accuracy: { min: 80 } },
      signalMap: { accuracy: 90 },
      status: "CERTIFIED"
    });
    assert.equal(out, null);

    const row = await queryOne(
      "SELECT * FROM certification_snapshot_retries WHERE release_id = $1",
      [releaseId]
    );
    assert.ok(row, "retry row should exist");
    assert.equal(Number(row.attempt), 1);
    assert.match(String(row.last_error || ""), /simulated_persist_failure/);
  });

  it("sweep deletes the queue row after a successful retry", async () => {
    const { ws, releaseId } = await seedCertifiedRelease();
    let calls = 0;

    mock.method(certificationSnapshots, "persistCertificationSnapshot", async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient_1");
      return { evidence_hash: "ok", frozen_at: nowIso() };
    });

    await enqueueCertificationSnapshotPersist({
      releaseId,
      workspaceId: ws,
      thresholdMap: { accuracy: { min: 80 } },
      signalMap: { accuracy: 90 },
      status: "CERTIFIED"
    });
    assert.equal(calls, 1);

    await makeDue(releaseId);
    const result = await processDueCertificationSnapshotRetries();
    assert.equal(result.succeeded, 1);
    assert.equal(calls, 2);

    const row = await queryOne(
      "SELECT * FROM certification_snapshot_retries WHERE release_id = $1",
      [releaseId]
    );
    assert.equal(row, undefined);
  });

  it("writes CERTIFICATION_SNAPSHOT_FAILED after exhausting retries", async () => {
    const { ws, releaseId } = await seedCertifiedRelease();

    mock.method(certificationSnapshots, "persistCertificationSnapshot", async () => {
      throw new Error("always_fail");
    });

    await enqueueCertificationSnapshotPersist({
      releaseId,
      workspaceId: ws,
      thresholdMap: { accuracy: { min: 80 } },
      signalMap: { accuracy: 90 },
      status: "CERTIFIED"
    });

    let exhausted = 0;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await makeDue(releaseId);
      const result = await processDueCertificationSnapshotRetries();
      exhausted += result.exhausted;
      if (result.exhausted > 0) break;
    }

    assert.equal(exhausted, 1);

    const row = await queryOne(
      "SELECT * FROM certification_snapshot_retries WHERE release_id = $1",
      [releaseId]
    );
    assert.equal(row, undefined);

    const audit = await queryOne(
      `SELECT * FROM audit_events
        WHERE release_id = $1 AND event_type = 'CERTIFICATION_SNAPSHOT_FAILED'
        ORDER BY id DESC LIMIT 1`,
      [releaseId]
    );
    assert.ok(audit, "expected CERTIFICATION_SNAPSHOT_FAILED audit");
    assert.match(String(audit.details_json || ""), /always_fail/);
  });
});
