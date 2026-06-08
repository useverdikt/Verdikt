import { describe, expect, it } from "vitest";
import { getSignalThresholdDirection, valueToThresholdBounds } from "./thresholdBounds.js";

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
});
