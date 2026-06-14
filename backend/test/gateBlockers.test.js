"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildGateBlockers } = require("../src/services/gateBlockers");

describe("buildGateBlockers", () => {
  it("returns empty blockers when gate is allowed", () => {
    const out = buildGateBlockers({
      status: "CERTIFIED",
      mode: "default",
      gateAllowed: true,
      gateReason: "release certified"
    });
    assert.deepEqual(out.blockers, []);
    assert.match(out.next_step, /Merge or deploy/i);
  });

  it("includes missing signals and collecting context", () => {
    const out = buildGateBlockers({
      status: "COLLECTING",
      mode: "default",
      gateAllowed: false,
      gateReason: "release still collecting required signals",
      missingRequiredSignals: ["accuracy", "safety"]
    });
    assert.equal(out.blockers.length, 3);
    assert.ok(out.blockers.some((b) => b.type === "collecting"));
    assert.ok(out.blockers.some((b) => b.signal_id === "accuracy"));
    assert.ok(out.blockers.every((b) => b.next_step));
  });

  it("includes threshold failures with rule detail", () => {
    const out = buildGateBlockers({
      status: "UNCERTIFIED",
      mode: "default",
      gateAllowed: false,
      gateReason: "release is uncertified",
      failedSignals: [{ signal_id: "accuracy", value: 70, rule: ">= 85", failure_kind: "absolute_threshold" }]
    });
    assert.ok(out.blockers.some((b) => b.type === "threshold_failed" && b.signal_id === "accuracy"));
    assert.match(out.next_step, /Fix the underlying/i);
  });
});
