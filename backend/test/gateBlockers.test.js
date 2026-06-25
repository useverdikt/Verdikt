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
  });

  it("includes remediation_debt blocker when override blocked by emergency merge debt", () => {
    const out = buildGateBlockers({
      status: "CERTIFIED_WITH_OVERRIDE",
      mode: "default",
      gateAllowed: false,
      gateReason: "Remediation debt active",
      remediationDebt: {
        active: true,
        source_release_id: "rel_debt",
        source_version: "hotfix (#99)",
        since: "2026-06-12T10:00:00.000Z",
        lookback_days: 7
      }
    });
    const debt = out.blockers.find((b) => b.type === "remediation_debt");
    assert.ok(debt);
    assert.equal(debt.source_version, "hotfix (#99)");
    assert.match(debt.next_step, /CERTIFIED/i);
    assert.match(out.next_step, /CERTIFIED/i);
  });

  it("omits remediation_debt blocker for emergency release types even under debt", () => {
    const out = buildGateBlockers({
      status: "CERTIFIED_WITH_OVERRIDE",
      mode: "default",
      gateAllowed: false,
      gateReason: "release certified with override",
      remediationDebt: { active: true, source_version: "hotfix (#99)" },
      isEmergencyRelease: true
    });
    assert.ok(!out.blockers.some((b) => b.type === "remediation_debt"));
  });

  it("includes remediation_debt blocker for a non-emergency bypass under debt", () => {
    const out = buildGateBlockers({
      status: "UNCERTIFIED",
      mode: "default",
      gateAllowed: false,
      gateReason: "Remediation debt active",
      remediationDebt: { active: true, source_version: "hotfix (#99)" },
      isEmergencyRelease: false
    });
    const debt = out.blockers.find((b) => b.type === "remediation_debt");
    assert.ok(debt, "non-emergency release under debt must surface remediation_debt blocker");
  });
});
