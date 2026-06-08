import { describe, expect, it } from "vitest";
import { applyThresholdApiMap, getDefaultThresholdUiState, getSignalThresholdDirection, thresholdNormalizedToApiPayload, valueToThresholdBounds } from "./thresholdBounds.js";

describe("thresholdBounds", () => {
  it("uses max for lower-is-better guardrails", () => {
    expect(getSignalThresholdDirection("crashrate")).toBe("max");
    expect(valueToThresholdBounds("crashrate", 0.1)).toEqual({ min: null, max: 0.1 });
  });

  it("uses min for higher-is-better signals", () => {
    expect(getSignalThresholdDirection("smoke")).toBe("min");
    expect(valueToThresholdBounds("smoke", 100)).toEqual({ min: 100, max: null });
  });

  it("uses max for latency ceilings", () => {
    expect(valueToThresholdBounds("p95latency", 300)).toEqual({ min: null, max: 300 });
  });

  it("merges industry defaults when API map is partial", () => {
    const defaults = getDefaultThresholdUiState();
    const { thresholds } = applyThresholdApiMap({ accuracy: { min: 88, max: null } });
    expect(thresholds.accuracy).toBe(88);
    expect(thresholds.smoke).toBe(defaults.smoke);
    expect(thresholds.crashrate).toBe(defaults.crashrate);
    expect(thresholds.manual_qa_showstopper).toBe("P0");
  });

  it("persists showstopper policy as manual_qa_worst_severity max on save", () => {
    const payload = thresholdNormalizedToApiPayload(
      { smoke: 100, manual_qa_showstopper: "P1" },
      { smoke: true }
    );
    expect(payload.manual_qa_worst_severity).toEqual({
      min: null,
      max: 3,
      required_for_certification: false
    });
  });

  it("hydrates showstopper label from stored worst severity max", () => {
    const { thresholds } = applyThresholdApiMap({
      manual_qa_worst_severity: { min: null, max: 3 }
    });
    expect(thresholds.manual_qa_showstopper).toBe("P1");
  });
});
