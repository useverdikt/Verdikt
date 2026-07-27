"use strict";

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const {
  log,
  inc,
  snapshotCounters,
  resetCounters
} = require("../src/lib/observability");

describe("observability", () => {
  const prevLogJson = process.env.LOG_JSON;

  beforeEach(() => {
    resetCounters();
    delete process.env.LOG_JSON;
    mock.restoreAll();
  });

  afterEach(() => {
    if (prevLogJson === undefined) delete process.env.LOG_JSON;
    else process.env.LOG_JSON = prevLogJson;
    mock.restoreAll();
    resetCounters();
  });

  it("increments and snapshots counters", () => {
    assert.equal(inc("gate_action_merge"), 1);
    assert.equal(inc("gate_action_merge", 2), 3);
    assert.equal(inc("escalation_sla_breach"), 1);
    assert.deepEqual(snapshotCounters(), {
      gate_action_merge: 3,
      escalation_sla_breach: 1
    });
  });

  it("emits JSON lines when LOG_JSON=1", () => {
    process.env.LOG_JSON = "1";
    const lines = [];
    mock.method(console, "error", (...args) => {
      lines.push(args[0]);
    });

    log("error", "cert_snapshot_exhausted", {
      releaseId: "rel_1",
      workspaceId: "ws_1",
      attempts: 4
    });

    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level, "error");
    assert.equal(parsed.event, "cert_snapshot_exhausted");
    assert.equal(parsed.releaseId, "rel_1");
    assert.equal(parsed.attempts, 4);
    assert.ok(parsed.ts);
  });

  it("emits human-readable lines by default", () => {
    const lines = [];
    mock.method(console, "log", (...args) => {
      lines.push(args[0]);
    });

    log("info", "gate_action", { action: "merge", releaseId: "rel_x" });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[gate_action\]/);
    assert.match(lines[0], /action=merge/);
    assert.match(lines[0], /releaseId=rel_x/);
  });
});
