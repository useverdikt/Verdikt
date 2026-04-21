import { describe, expect, it } from "vitest";
import { calcVerdict, DEFAULT_THRESHOLDS, evaluateSignal } from "./appMainLogic.js";

describe("evaluateSignal", () => {
  it("test direction: pass when rate meets floor and no P0", () => {
    const sig = { direction: "test", unit: "%" };
    expect(evaluateSignal(sig, { rate: 98, severity: "P4" }, 95).pass).toBe(true);
    expect(evaluateSignal(sig, { rate: 90, severity: "none" }, 95).pass).toBe(false);
    expect(evaluateSignal(sig, { rate: 100, severity: "P0" }, 95).pass).toBe(false);
  });

  it("above / below numeric comparisons", () => {
    expect(evaluateSignal({ direction: "above", unit: "%" }, 88, 85).pass).toBe(true);
    expect(evaluateSignal({ direction: "below", unit: "s" }, 2.0, 3.0).pass).toBe(true);
    expect(evaluateSignal({ direction: "below", unit: "s" }, 4.0, 3.0).pass).toBe(false);
  });
});

describe("calcVerdict", () => {
  const baseT = { ...DEFAULT_THRESHOLDS };

  it("returns SHIP when all evaluated signals pass", () => {
    const signals = {
      smoke: { rate: 100, severity: "none" },
      e2e_regression: { rate: 97, severity: "P4" },
      startup: 2.4,
      crashrate: 0.05,
      accuracy: 90,
      safety: 92,
      tone: 88,
      hallucination: 93,
      relevance: 86
    };
    const v = calcVerdict(signals, baseT, "prompt_update");
    expect(v.recommendation).toBe("SHIP");
    expect(v.failing).toHaveLength(0);
  });

  it("BLOCK when smoke rate is below floor", () => {
    const v = calcVerdict(
      { smoke: { rate: 80, severity: "none" } },
      { ...baseT, smoke: 100 },
      "prompt_update"
    );
    expect(v.recommendation).toBe("BLOCK");
    expect(v.failing.some((f) => f.sigId === "smoke")).toBe(true);
  });

  it("adds delta regression failure when drop exceeds maxDrop while floor still passes", () => {
    const thresholds = { ...baseT, accuracy: 85, accuracy_delta: 5 };
    const v = calcVerdict({ accuracy: 86 }, thresholds, "model_update", { accuracy: 96 });
    expect(v.recommendation).toBe("BLOCK");
    const deltaFail = v.failing.find((f) => f.isDeltaFail);
    expect(deltaFail).toBeDefined();
    expect(deltaFail.sigId).toBe("accuracy");
    expect(deltaFail.drop).toBe(10);
  });
});
