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
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const {
  claimDueCollectionReleases,
  completeCollectionSweepClaim,
  recordCollectionSweepClaimFailure
} = require("../src/services/collectionSweepClaims");
const { nowIso } = require("../src/lib/time");

before(async () => {
  await initDatabase();
});

async function seedDueReleases(count) {
  const workspaceId = `ws_claim_${crypto.randomBytes(4).toString("hex")}`;
  await ensureWorkspaceSeeded(workspaceId);
  const releaseIds = [];
  for (let index = 0; index < count; index += 1) {
    const releaseId = `rel_claim_${crypto.randomBytes(5).toString("hex")}`;
    const timestamp = nowIso();
    await run(
      `INSERT INTO releases
         (id, workspace_id, version, release_type, environment, status, created_at, updated_at, collection_deadline)
       VALUES ($1, $2, $3, 'model_update', 'pre-prod', 'COLLECTING', $4, $4, NOW() - INTERVAL '1 minute')`,
      [releaseId, workspaceId, `claim-v${index}`, timestamp]
    );
    releaseIds.push(releaseId);
  }
  return { workspaceId, releaseIds };
}

describe("collection sweep durable claims", () => {
  it("gives concurrent workers disjoint batches and recovers an expired lease", async () => {
    const { workspaceId, releaseIds } = await seedDueReleases(4);

    const [workerA, workerB] = await Promise.all([
      claimDueCollectionReleases({
        limit: 4,
        workerId: "claim-worker-a",
        leaseMs: 60_000,
        workspaceId
      }),
      claimDueCollectionReleases({
        limit: 4,
        workerId: "claim-worker-b",
        leaseMs: 60_000,
        workspaceId
      })
    ]);

    const idsA = new Set(workerA.map((row) => row.id));
    const idsB = new Set(workerB.map((row) => row.id));
    assert.equal([...idsA].some((id) => idsB.has(id)), false, "workers must not share a release");
    assert.deepEqual(
      new Set([...idsA, ...idsB]),
      new Set(releaseIds),
      "all due releases should be claimed once"
    );

    const unavailable = await claimDueCollectionReleases({
      limit: 4,
      workerId: "claim-worker-c",
      leaseMs: 60_000,
      workspaceId
    });
    assert.equal(unavailable.length, 0, "active leases must not be stolen");

    const expiredReleaseId = releaseIds[0];
    await run(
      `UPDATE collection_sweep_claims
          SET lease_until = NOW() - INTERVAL '1 second'
        WHERE release_id = $1`,
      [expiredReleaseId]
    );

    const recovered = await claimDueCollectionReleases({
      limit: 1,
      workerId: "claim-worker-c",
      leaseMs: 60_000,
      workspaceId
    });
    assert.deepEqual(recovered.map((row) => row.id), [expiredReleaseId]);
    const recoveredClaim = await queryOne(
      `SELECT claimed_by, attempt_count
         FROM collection_sweep_claims
        WHERE release_id = $1`,
      [expiredReleaseId]
    );
    assert.equal(recoveredClaim.claimed_by, "claim-worker-c");
    assert.equal(Number(recoveredClaim.attempt_count), 2);
  });

  it("records failures and only lets the current owner complete a claim", async () => {
    const { workspaceId, releaseIds } = await seedDueReleases(1);
    const releaseId = releaseIds[0];
    const claimed = await claimDueCollectionReleases({
      limit: 1,
      workerId: "claim-owner",
      leaseMs: 60_000,
      workspaceId
    });
    assert.equal(claimed.length, 1);

    await recordCollectionSweepClaimFailure(releaseId, "claim-owner", new Error("temporary evaluation failure"));
    const failedClaim = await queryOne(
      `SELECT last_error FROM collection_sweep_claims WHERE release_id = $1`,
      [releaseId]
    );
    assert.match(failedClaim.last_error, /temporary evaluation failure/);

    const wrongOwner = await completeCollectionSweepClaim(releaseId, "different-worker");
    assert.equal(wrongOwner.changes, 0);
    assert.ok(
      await queryOne("SELECT release_id FROM collection_sweep_claims WHERE release_id = $1", [releaseId])
    );

    const completed = await completeCollectionSweepClaim(releaseId, "claim-owner");
    assert.equal(completed.changes, 1);
    assert.equal(
      await queryOne("SELECT release_id FROM collection_sweep_claims WHERE release_id = $1", [releaseId]),
      undefined
    );
  });
});
