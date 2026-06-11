"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifySignalSource,
  summarizeEvidence,
  deriveEvidenceQualityFlag,
  latestSignalRowsById
} = require("../src/services/evidenceQuality");

describe("evidenceQuality", () => {
  it("classifies source tiers", () => {
    assert.equal(classifySignalSource("pulled:braintrust"), "integration");
    assert.equal(classifySignalSource("simulator:datadog"), "simulator");
    assert.equal(classifySignalSource("agent"), "programmatic");
    assert.equal(classifySignalSource("ci"), "programmatic");
    assert.equal(classifySignalSource("manual"), "manual");
    assert.equal(classifySignalSource(null), "manual");
  });

  it("uses latest row per signal_id", () => {
    const latest = latestSignalRowsById([
      { signal_id: "accuracy", value: 80, source: "simulator:braintrust" },
      { signal_id: "accuracy", value: 88, source: "pulled:braintrust" }
    ]);
    assert.equal(latest.length, 1);
    assert.equal(latest[0].source, "pulled:braintrust");
  });

  it("summarizes mixed evidence line", () => {
    const summary = summarizeEvidence([
      { signal_id: "accuracy", source: "pulled:braintrust" },
      { signal_id: "smoke", source: "simulator:browserstack" },
      { signal_id: "safety", source: "pulled:braintrust" }
    ]);
    assert.equal(summary.total, 3);
    assert.equal(summary.by_tier.integration, 2);
    assert.equal(summary.by_tier.simulator, 1);
    assert.match(summary.line, /integration pull/);
    assert.match(summary.line, /Signal Simulator/);
    assert.equal(deriveEvidenceQualityFlag(summary), "MIXED");
  });

  it("flags pure integration and simulator", () => {
    const integration = summarizeEvidence([
      { signal_id: "a", source: "pulled:braintrust" },
      { signal_id: "b", source: "pulled:datadog" }
    ]);
    assert.equal(deriveEvidenceQualityFlag(integration), "INTEGRATION_BACKED");

    const simulator = summarizeEvidence([{ signal_id: "a", source: "simulator:braintrust" }]);
    assert.equal(deriveEvidenceQualityFlag(simulator), "SIMULATOR_BACKED");
  });
});
