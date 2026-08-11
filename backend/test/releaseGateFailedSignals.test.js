"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveGateFailedSignals } = require("../src/services/releaseGate");

describe("gate failed-signal reads", () => {
  it("uses persisted threshold failures with frozen snapshot evidence", async () => {
    const persisted = [{ signal_id: "accuracy", value: 70, rule: "min 80" }];
    let recalculations = 0;

    const result = await resolveGateFailedSignals({
      intelligence: { verdict: { threshold_failed_signals: persisted } },
      release: {
        id: "rel_gate_persisted",
        workspace_id: "ws_gate",
        status: "CERTIFIED_WITH_OVERRIDE"
      },
      latest: { accuracy: 70 },
      thresholdMap: { accuracy: { min: 80 } },
      evidenceSource: "snapshot",
      computeVerdictFn: async () => {
        recalculations++;
        return { failed_signals: [] };
      }
    });

    assert.deepEqual(result, persisted);
    assert.equal(recalculations, 0);
  });

  it("treats a persisted empty snapshot array as authoritative", async () => {
    let recalculations = 0;

    const result = await resolveGateFailedSignals({
      intelligence: { verdict: { threshold_failed_signals: [] } },
      release: {
        id: "rel_gate_override",
        workspace_id: "ws_gate",
        status: "CERTIFIED_WITH_OVERRIDE"
      },
      latest: {},
      thresholdMap: {},
      evidenceSource: "snapshot",
      computeVerdictFn: async () => {
        recalculations++;
        return { failed_signals: [{ signal_id: "stale" }] };
      }
    });

    assert.deepEqual(result, []);
    assert.equal(recalculations, 0);
  });

  it("recalculates for legacy snapshot intelligence without the persisted field", async () => {
    const fallback = [{ signal_id: "safety", value: 70, rule: "min 90" }];
    let recalculations = 0;

    const result = await resolveGateFailedSignals({
      intelligence: { verdict: { summary: "legacy verdict intelligence" } },
      release: {
        id: "rel_gate_legacy",
        workspace_id: "ws_gate",
        status: "CERTIFIED_WITH_OVERRIDE"
      },
      latest: { safety: 70 },
      thresholdMap: { safety: { min: 90 } },
      evidenceSource: "snapshot",
      computeVerdictFn: async () => {
        recalculations++;
        return { failed_signals: fallback };
      }
    });

    assert.deepEqual(result, fallback);
    assert.equal(recalculations, 1);
  });

  it("recalculates live UNCERTIFIED evidence after threshold changes", async () => {
    const persisted = [{ signal_id: "accuracy", value: 70, rule: "min 80" }];
    const live = [{ signal_id: "safety", value: 70, rule: "min 90" }];
    let recalculations = 0;

    const result = await resolveGateFailedSignals({
      intelligence: { verdict: { threshold_failed_signals: persisted } },
      release: { id: "rel_gate_live", workspace_id: "ws_gate", status: "UNCERTIFIED" },
      latest: { accuracy: 85, safety: 70 },
      thresholdMap: { accuracy: { min: 80 }, safety: { min: 90 } },
      evidenceSource: "live",
      computeVerdictFn: async () => {
        recalculations++;
        return { failed_signals: live };
      }
    });

    assert.deepEqual(result, live);
    assert.equal(recalculations, 1);
  });
});
