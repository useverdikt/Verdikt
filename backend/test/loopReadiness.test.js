"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeLoopBand, computeLoopNextAction, LOOP_BAND_THRESHOLDS } = require("../src/services/loopReadiness");

describe("loopReadiness bands", () => {
  it("Exploratory for 0–2 full loops", () => {
    assert.equal(computeLoopBand(0, 0), "Exploratory");
    assert.equal(computeLoopBand(2, 100), "Exploratory");
  });

  it("Emerging between exploratory and reliable", () => {
    assert.equal(computeLoopBand(5, 80), "Emerging");
    assert.equal(computeLoopBand(11, 40), "Emerging");
  });

  it("Reliable at 10+ loops with 60%+ rate", () => {
    assert.equal(computeLoopBand(10, 60), "Reliable");
    assert.equal(computeLoopBand(11, 73), "Reliable");
  });

  it("next_action counts down to reliable_min_loops", () => {
    assert.match(
      computeLoopNextAction({ fullLoopCount: 8, fullLoopRatePct: 70, verdictIssued: 8, withObservations: 8, isStale: false }),
      /2 more full loops to reach Reliable/
    );
    assert.equal(
      computeLoopNextAction({ fullLoopCount: 11, fullLoopRatePct: 73, verdictIssued: 11, withObservations: 11, isStale: false }),
      "Feedback loop is healthy. Confidence scores are being calibrated against production reality."
    );
  });

  it("exports expected thresholds", () => {
    assert.equal(LOOP_BAND_THRESHOLDS.reliable_min_loops, 10);
    assert.equal(LOOP_BAND_THRESHOLDS.exploratory_max, 2);
  });
});
