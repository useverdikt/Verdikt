"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  listTaintedVcsHealthEvidence,
  requeueTaintedVcsHealthEvidence
} = require("../src/services/vcsMonitoringRepair");

describe("VCS monitoring evidence repair", () => {
  it("lists only release identities without exposing record payloads", async () => {
    let args = null;
    const releases = await listTaintedVcsHealthEvidence("ws_repair", {
      since: "2026-06-07T00:00:00.000Z",
      queryAllFn: async (_sql, queryArgs) => {
        args = queryArgs;
        return [{ release_id: "rel_a" }, { release_id: "rel_b" }];
      }
    });

    assert.deepEqual(args, ["ws_repair", "2026-06-07T00:00:00.000Z"]);
    assert.deepEqual(releases, ["rel_a", "rel_b"]);
  });

  it("atomically removes tainted observations and requeues their windows", async () => {
    const calls = [];
    const auditCalls = [];
    const tx = {
      query: async (sql, args) => calls.push(["query", sql, args]),
      queryAll: async (sql, args) => {
        calls.push(["queryAll", sql, args]);
        return [{ release_id: "rel_a" }, { release_id: "rel_b" }];
      },
      queryOne: async (sql, args) => {
        calls.push(["queryOne", sql, args]);
        if (sql.includes("production_observations")) return { count: 8 };
        if (sql.includes("production_adjustment_cache")) return { count: 1 };
        return { count: 2 };
      },
      run: async (sql, args) => calls.push(["run", sql, args])
    };

    const result = await requeueTaintedVcsHealthEvidence("ws_repair", {
      since: "2026-06-07T00:00:00.000Z",
      transactionFn: async (work) => work(tx),
      writeAuditFn: async (event) => auditCalls.push(event)
    });

    assert.deepEqual(result, {
      workspace_id: "ws_repair",
      windows_requeued: 2,
      observations_removed: 8,
      alignments_invalidated: 2,
      adjustment_cache_invalidated: 1
    });
    const resetCall = calls.find(([kind]) => kind === "run");
    assert.match(resetCall[1], /status = 'pending'/);
    assert.deepEqual(resetCall[2], ["ws_repair", ["rel_a", "rel_b"]]);
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].eventType, "VCS_MONITOR_EVIDENCE_REQUEUED");
    assert.equal(auditCalls[0].details.windows_requeued, 2);
    assert.equal(auditCalls[0].tx, tx);
  });

  it("performs no destructive work when no tainted windows remain", async () => {
    let mutationCalls = 0;
    const tx = {
      query: async () => {},
      queryAll: async () => [],
      queryOne: async () => {
        mutationCalls += 1;
      },
      run: async () => {
        mutationCalls += 1;
      }
    };

    const result = await requeueTaintedVcsHealthEvidence("ws_clean", {
      transactionFn: async (work) => work(tx),
      writeAuditFn: async () => {
        mutationCalls += 1;
      }
    });

    assert.equal(result.windows_requeued, 0);
    assert.equal(mutationCalls, 0);
  });
});
