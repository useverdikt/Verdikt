"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  runCollectionDeadlineSweep,
  resolveCollectionSweepClaimMode
} = require("../src/jobs/collectionSweep");

describe("collection deadline sweep", () => {
  it("loads only due collecting releases in a bounded batch", async () => {
    const evaluated = [];
    const loggedEvents = [];
    let capturedSql = "";
    let capturedParams = [];

    const result = await runCollectionDeadlineSweep({
      limit: 25,
      claimMode: "observe",
      queryAllFn: async (sql, params) => {
        capturedSql = sql;
        capturedParams = params;
        return [
          { id: "rel_due_1", collection_deadline: "2026-08-11T00:00:00.000Z" },
          { id: "rel_due_2", collection_deadline: "2026-08-11T00:01:00.000Z" }
        ];
      },
      evaluateFn: async (_release, releaseId, source, signalCount) => {
        evaluated.push({ releaseId, source, signalCount });
      },
      claimBatchFn: async () => {
        throw new Error("observe mode must not write claims");
      },
      logFn: (_level, event, fields) => loggedEvents.push({ event, fields }),
      incFn: () => {}
    });

    assert.match(capturedSql, /status = 'COLLECTING'/);
    assert.match(capturedSql, /collection_deadline <= NOW\(\)/);
    assert.match(capturedSql, /ORDER BY collection_deadline ASC, id ASC/);
    assert.match(capturedSql, /LIMIT \$1/);
    assert.deepEqual(capturedParams, [25]);
    assert.deepEqual(evaluated, [
      { releaseId: "rel_due_1", source: "collection_deadline_sweep", signalCount: 0 },
      { releaseId: "rel_due_2", source: "collection_deadline_sweep", signalCount: 0 }
    ]);
    assert.equal(loggedEvents[0].event, "collection_sweep_claim_observed");
    assert.equal(loggedEvents[0].fields.releaseCount, 2);
    assert.deepEqual(result, {
      mode: "observe",
      worker_id: result.worker_id,
      selected: 2,
      succeeded: 2,
      failed: 0
    });
  });

  it("enforces claims, completes successes, and leases failures for retry", async () => {
    const evaluated = [];
    const completed = [];
    const failed = [];
    const result = await runCollectionDeadlineSweep({
      claimMode: "enforce",
      workerId: "worker-a",
      queryAllFn: async () => {
        throw new Error("enforce mode must load through the claim query");
      },
      claimBatchFn: async ({ workerId }) => {
        assert.equal(workerId, "worker-a");
        return [{ id: "rel_bad" }, { id: "rel_good" }];
      },
      evaluateFn: async (_release, releaseId) => {
        evaluated.push(releaseId);
        if (releaseId === "rel_bad") throw new Error("simulated");
      },
      completeClaimFn: async (releaseId, workerId) => completed.push({ releaseId, workerId }),
      failClaimFn: async (releaseId, workerId, error) =>
        failed.push({ releaseId, workerId, error: error.message }),
      logFn: () => {},
      incFn: () => {}
    });

    assert.deepEqual(evaluated, ["rel_bad", "rel_good"]);
    assert.deepEqual(completed, [{ releaseId: "rel_good", workerId: "worker-a" }]);
    assert.deepEqual(failed, [{ releaseId: "rel_bad", workerId: "worker-a", error: "simulated" }]);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 1);
  });

  it("falls back to observation for invalid modes and supports an explicit off mode", async () => {
    assert.equal(resolveCollectionSweepClaimMode("unexpected"), "observe");
    assert.equal(resolveCollectionSweepClaimMode("ENFORCE"), "enforce");
    assert.equal(resolveCollectionSweepClaimMode("off"), "off");

    const events = [];
    const result = await runCollectionDeadlineSweep({
      claimMode: "off",
      workerId: "worker-off",
      queryAllFn: async () => [{ id: "rel_due" }],
      evaluateFn: async () => {},
      logFn: (_level, event) => events.push(event),
      incFn: () => {}
    });
    assert.equal(result.mode, "off");
    assert.deepEqual(events, []);
  });
});
