"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { runCollectionDeadlineSweep } = require("../src/jobs/collectionSweep");

describe("collection deadline sweep", () => {
  it("loads only due collecting releases in a bounded batch", async () => {
    const evaluated = [];
    let capturedSql = "";
    let capturedParams = [];

    await runCollectionDeadlineSweep({
      limit: 25,
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
      }
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
  });

  it("continues after one release evaluation fails", async () => {
    const evaluated = [];
    const originalError = console.error;
    console.error = () => {};
    try {
      await runCollectionDeadlineSweep({
        queryAllFn: async () => [{ id: "rel_bad" }, { id: "rel_good" }],
        evaluateFn: async (_release, releaseId) => {
          evaluated.push(releaseId);
          if (releaseId === "rel_bad") throw new Error("simulated");
        }
      });
    } finally {
      console.error = originalError;
    }

    assert.deepEqual(evaluated, ["rel_bad", "rel_good"]);
  });
});
