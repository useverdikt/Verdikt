"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveGateFailedSignals } = require("../src/services/releaseGate");

describe("gate failed-signal reads", () => {
  it("uses persisted failed signals without recalculating the verdict", async () => {
    const persisted = [{ signal_id: "accuracy", value: 70, rule: "min 80" }];
    let recalculations = 0;

    const result = await resolveGateFailedSignals({
      intelligence: { verdict: { failed_signals: persisted } },
      release: { id: "rel_gate_persisted", workspace_id: "ws_gate", status: "UNCERTIFIED" },
      latest: { accuracy: 70 },
      thresholdMap: { accuracy: { min: 80 } },
      computeVerdictFn: async () => {
        recalculations++;
        return { failed_signals: [] };
      }
    });

    assert.deepEqual(result, persisted);
    assert.equal(recalculations, 0);
  });

  it("treats a persisted empty array as authoritative", async () => {
    let recalculations = 0;

    const result = await resolveGateFailedSignals({
      intelligence: { verdict: { failed_signals: [] } },
      release: {
        id: "rel_gate_override",
        workspace_id: "ws_gate",
        status: "CERTIFIED_WITH_OVERRIDE"
      },
      latest: {},
      thresholdMap: {},
      computeVerdictFn: async () => {
        recalculations++;
        return { failed_signals: [{ signal_id: "stale" }] };
      }
    });

    assert.deepEqual(result, []);
    assert.equal(recalculations, 0);
  });

  it("recalculates only for legacy blocked intelligence without the persisted field", async () => {
    const fallback = [{ signal_id: "safety", value: 70, rule: "min 90" }];
    let recalculations = 0;

    const result = await resolveGateFailedSignals({
      intelligence: { verdict: { summary: "legacy verdict intelligence" } },
      release: { id: "rel_gate_legacy", workspace_id: "ws_gate", status: "UNCERTIFIED" },
      latest: { safety: 70 },
      thresholdMap: { safety: { min: 90 } },
      computeVerdictFn: async () => {
        recalculations++;
        return { failed_signals: fallback };
      }
    });

    assert.deepEqual(result, fallback);
    assert.equal(recalculations, 1);
  });
});
