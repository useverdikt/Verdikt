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
  enqueueRetryJob,
  processDueCertificationSnapshotRetries,
  backfillMissingCertificationSnapshots,
  _resetCertificationSnapshotRetryState,
  MAX_ATTEMPTS
} = require("../src/services/certificationSnapshotRetry");
const {
  claimDueCertificationSnapshotRetries,
  completeCertificationSnapshotRetryClaim,
  claimMissingCertificationSnapshots,
  completeCertificationSnapshotBackfillClaim
} = require("../src/services/certificationSnapshotClaims");
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

  it("gives concurrent retry workers disjoint owner-scoped claims", async () => {
    const { ws, releaseId } = await seedCertifiedRelease();
    const args = {
      releaseId,
      workspaceId: ws,
      thresholdMap: { accuracy: { min: 80 } },
      signalMap: { accuracy: 90 },
      status: "CERTIFIED"
    };
    await enqueueRetryJob(args, 1, new Error("seed_retry"));
    await makeDue(releaseId);

    let persistCalls = 0;
    const persistFn = async () => {
      persistCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
    };
    const [first, second] = await Promise.all([
      processDueCertificationSnapshotRetries({ workerId: "retry-worker-a", persistFn }),
      processDueCertificationSnapshotRetries({ workerId: "retry-worker-b", persistFn })
    ]);

    assert.equal(first.processed + second.processed, 1);
    assert.equal(first.succeeded + second.succeeded, 1);
    assert.equal(persistCalls, 1);
  });

  it("does not let an expired retry owner complete a reclaimed row", async () => {
    const { ws, releaseId } = await seedCertifiedRelease();
    await enqueueRetryJob(
      {
        releaseId,
        workspaceId: ws,
        thresholdMap: {},
        signalMap: {},
        status: "CERTIFIED"
      },
      1,
      new Error("seed_retry")
    );
    await makeDue(releaseId);

    const first = await claimDueCertificationSnapshotRetries({
      workerId: "expired-retry-owner",
      leaseMs: 60_000
    });
    assert.equal(first.length, 1);
    await run(
      `UPDATE certification_snapshot_retries
          SET lease_until = NOW() - INTERVAL '1 second'
        WHERE release_id = $1`,
      [releaseId]
    );
    const second = await claimDueCertificationSnapshotRetries({
      workerId: "current-retry-owner",
      leaseMs: 60_000
    });
    assert.equal(second.length, 1);

    const staleCompletion = await completeCertificationSnapshotRetryClaim(
      releaseId,
      "expired-retry-owner"
    );
    assert.equal(staleCompletion.changes, 0);
    const currentCompletion = await completeCertificationSnapshotRetryClaim(
      releaseId,
      "current-retry-owner"
    );
    assert.equal(currentCompletion.changes, 1);
  });

  it("invalidates an active retry owner when newer snapshot evidence is queued", async () => {
    const { ws, releaseId } = await seedCertifiedRelease();
    const original = {
      releaseId,
      workspaceId: ws,
      thresholdMap: { accuracy: { min: 80 } },
      signalMap: { accuracy: 81 },
      status: "CERTIFIED"
    };
    await enqueueRetryJob(original, 2, new Error("old_failure"));
    await makeDue(releaseId);
    const claimed = await claimDueCertificationSnapshotRetries({
      workerId: "stale-retry-owner"
    });
    assert.equal(claimed.length, 1);

    await enqueueRetryJob(
      {
        ...original,
        signalMap: { accuracy: 95 }
      },
      1,
      new Error("new_failure")
    );

    const row = await queryOne(
      `SELECT claimed_by, lease_until, signal_snapshot_json
         FROM certification_snapshot_retries
        WHERE release_id = $1`,
      [releaseId]
    );
    assert.equal(row.claimed_by, null);
    assert.equal(row.lease_until, null);
    assert.deepEqual(JSON.parse(row.signal_snapshot_json), { accuracy: 95 });
    const staleCompletion = await completeCertificationSnapshotRetryClaim(
      releaseId,
      "stale-retry-owner"
    );
    assert.equal(staleCompletion.changes, 0);
  });

  it("leases startup backfills so concurrent workers build one snapshot", async () => {
    const { ws, releaseId } = await seedCertifiedRelease();
    const [first, second] = await Promise.all([
      backfillMissingCertificationSnapshots({
        releaseId,
        workspaceId: ws,
        workerId: "backfill-worker-a"
      }),
      backfillMissingCertificationSnapshots({
        releaseId,
        workspaceId: ws,
        workerId: "backfill-worker-b"
      })
    ]);

    assert.equal(first.processed + second.processed, 1);
    assert.equal(first.succeeded + second.succeeded, 1);
    const snapshot = await queryOne(
      "SELECT release_id FROM certification_snapshots WHERE release_id = $1",
      [releaseId]
    );
    assert.equal(snapshot.release_id, releaseId);
  });

  it("allows an expired startup-backfill lease to be reclaimed", async () => {
    const { ws, releaseId } = await seedCertifiedRelease();
    const first = await claimMissingCertificationSnapshots({
      releaseId,
      workspaceId: ws,
      workerId: "expired-backfill-owner",
      leaseMs: 60_000
    });
    assert.equal(first.length, 1);
    await run(
      `UPDATE certification_snapshot_backfill_claims
          SET lease_until = NOW() - INTERVAL '1 second'
        WHERE release_id = $1`,
      [releaseId]
    );
    const second = await claimMissingCertificationSnapshots({
      releaseId,
      workspaceId: ws,
      workerId: "current-backfill-owner",
      leaseMs: 60_000
    });
    assert.equal(second.length, 1);

    const staleCompletion = await completeCertificationSnapshotBackfillClaim(
      releaseId,
      "expired-backfill-owner"
    );
    assert.equal(staleCompletion.changes, 0);
    const currentCompletion = await completeCertificationSnapshotBackfillClaim(
      releaseId,
      "current-backfill-owner"
    );
    assert.equal(currentCompletion.changes, 1);
  });
});
