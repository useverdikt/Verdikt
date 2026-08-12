"use strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const crypto = require("crypto");
const { before, describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { initDatabase, queryOne, run } = require("../src/database");
const { runVcsMonitorSweep } = require("../src/jobs/vcsMonitorSweep");
const {
  claimDueVcsMonitoringWindows,
  completeVcsMonitorSweepClaim,
  recordVcsMonitorSweepClaimFailure
} = require("../src/services/vcsMonitorSweepClaims");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { nowIso } = require("../src/lib/time");

before(async () => {
  await initDatabase();
});

async function seedDueWindows(count) {
  const workspaceId = `ws_vcs_claim_${crypto.randomBytes(4).toString("hex")}`;
  await ensureWorkspaceSeeded(workspaceId);
  const releaseIds = [];

  for (let index = 0; index < count; index += 1) {
    const releaseId = `rel_vcs_claim_${crypto.randomBytes(5).toString("hex")}`;
    const timestamp = nowIso();
    await run(
      `INSERT INTO releases
         (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'model_update', 'prod', 'CERTIFIED', $4, $4)`,
      [releaseId, workspaceId, `vcs-claim-v${index}`, timestamp]
    );
    await run(
      `INSERT INTO vcs_monitoring_windows
         (release_id, workspace_id, commit_sha, pr_number, monitoring_start, monitoring_end,
          window_minutes, status, last_scanned_at, scan_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 120, 'pending', NULL, 0, $5)`,
      [
        releaseId,
        workspaceId,
        crypto.randomBytes(20).toString("hex"),
        10_000 + index,
        timestamp,
        new Date(Date.parse(timestamp) + 120 * 60_000).toISOString()
      ]
    );
    releaseIds.push(releaseId);
  }

  return { workspaceId, releaseIds };
}

describe("VCS monitor sweep durable claims", () => {
  it("gives concurrent workers disjoint batches and recovers an expired lease", async () => {
    const { workspaceId, releaseIds } = await seedDueWindows(4);

    const [workerA, workerB] = await Promise.all([
      claimDueVcsMonitoringWindows({
        limit: 4,
        workerId: "vcs-claim-worker-a",
        leaseMs: 60_000,
        workspaceId
      }),
      claimDueVcsMonitoringWindows({
        limit: 4,
        workerId: "vcs-claim-worker-b",
        leaseMs: 60_000,
        workspaceId
      })
    ]);

    const idsA = new Set(workerA.map((row) => row.release_id));
    const idsB = new Set(workerB.map((row) => row.release_id));
    assert.equal([...idsA].some((id) => idsB.has(id)), false);
    assert.deepEqual(new Set([...idsA, ...idsB]), new Set(releaseIds));

    const unavailable = await claimDueVcsMonitoringWindows({
      limit: 4,
      workerId: "vcs-claim-worker-c",
      leaseMs: 60_000,
      workspaceId
    });
    assert.equal(unavailable.length, 0);

    const expiredReleaseId = releaseIds[0];
    await run(
      `UPDATE vcs_monitor_sweep_claims
          SET lease_until = NOW() - INTERVAL '1 second'
        WHERE release_id = $1`,
      [expiredReleaseId]
    );

    const recovered = await claimDueVcsMonitoringWindows({
      limit: 1,
      workerId: "vcs-claim-worker-c",
      leaseMs: 60_000,
      workspaceId
    });
    assert.deepEqual(recovered.map((row) => row.release_id), [expiredReleaseId]);
    const recoveredClaim = await queryOne(
      `SELECT claimed_by, attempt_count
         FROM vcs_monitor_sweep_claims
        WHERE release_id = $1`,
      [expiredReleaseId]
    );
    assert.equal(recoveredClaim.claimed_by, "vcs-claim-worker-c");
    assert.equal(Number(recoveredClaim.attempt_count), 2);
  });

  it("records failures and only lets the current owner complete a claim", async () => {
    const { workspaceId, releaseIds } = await seedDueWindows(1);
    const releaseId = releaseIds[0];
    const claimed = await claimDueVcsMonitoringWindows({
      limit: 1,
      workerId: "vcs-claim-owner",
      leaseMs: 60_000,
      workspaceId
    });
    assert.equal(claimed.length, 1);

    await recordVcsMonitorSweepClaimFailure(
      releaseId,
      "vcs-claim-owner",
      new Error("temporary provider failure")
    );
    const failedClaim = await queryOne(
      "SELECT last_error FROM vcs_monitor_sweep_claims WHERE release_id = $1",
      [releaseId]
    );
    assert.match(failedClaim.last_error, /temporary provider failure/);

    const wrongOwner = await completeVcsMonitorSweepClaim(releaseId, "different-worker");
    assert.equal(wrongOwner.changes, 0);
    assert.ok(
      await queryOne("SELECT release_id FROM vcs_monitor_sweep_claims WHERE release_id = $1", [
        releaseId
      ])
    );

    const completed = await completeVcsMonitorSweepClaim(releaseId, "vcs-claim-owner");
    assert.equal(completed.changes, 1);
    assert.equal(
      await queryOne("SELECT release_id FROM vcs_monitor_sweep_claims WHERE release_id = $1", [
        releaseId
      ]),
      undefined
    );
  });

  it("claims only windows whose rescan interval has elapsed", async () => {
    const { workspaceId, releaseIds } = await seedDueWindows(2);
    await run(
      `UPDATE vcs_monitoring_windows
          SET last_scanned_at = CASE
            WHEN release_id = $1 THEN NOW()
            ELSE NOW() - INTERVAL '10 minutes'
          END
        WHERE release_id = ANY($2::text[])`,
      [releaseIds[0], releaseIds]
    );

    const claimed = await claimDueVcsMonitoringWindows({
      limit: 2,
      workerId: "vcs-rescan-worker",
      leaseMs: 60_000,
      minRescanMs: 5 * 60_000,
      workspaceId
    });

    assert.deepEqual(claimed.map((row) => row.release_id), [releaseIds[1]]);
  });

  it("completes successful scans and retains failed claims for lease recovery", async () => {
    const windows = [{ release_id: "rel-success" }, { release_id: "rel-failure" }];
    const completed = [];
    const failures = [];

    const summary = await runVcsMonitorSweep({
      workerId: "vcs-job-worker",
      claimBatchFn: async () => windows,
      scanFn: async (window) => {
        if (window.release_id === "rel-failure") throw new Error("unexpected scan failure");
        return "scanning";
      },
      completeClaimFn: async (releaseId, workerId) => {
        completed.push({ releaseId, workerId });
        return { changes: 1 };
      },
      failClaimFn: async (releaseId, workerId, error) => {
        failures.push({ releaseId, workerId, message: error.message });
        return { changes: 1 };
      },
      logFn: () => {},
      incFn: () => {}
    });

    assert.deepEqual(summary, {
      worker_id: "vcs-job-worker",
      selected: 2,
      succeeded: 1,
      failed: 1
    });
    assert.deepEqual(completed, [
      { releaseId: "rel-success", workerId: "vcs-job-worker" }
    ]);
    assert.deepEqual(failures, [
      {
        releaseId: "rel-failure",
        workerId: "vcs-job-worker",
        message: "unexpected scan failure"
      }
    ]);
  });
});
