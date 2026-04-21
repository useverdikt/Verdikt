import { describe, it, expect } from "vitest";
import { esc, regReqd, evalSig, calcV, fmt, applyAISuggestionsToThresh } from "./onboardingUtils.js";

describe("esc", () => {
  it("escapes HTML special characters", () => {
    expect(esc(`a<b>"c'`)).toBe("a&lt;b&gt;&quot;c&#39;");
  });
  it("handles null and undefined", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("regReqd", () => {
  it("returns true for regression-required types", () => {
    expect(regReqd("prompt_update")).toBe(true);
  });
  it("returns false for waivable types", () => {
    expect(regReqd("model_patch")).toBe(false);
  });
  it("returns null for unknown type", () => {
    expect(regReqd("unknown_type")).toBe(null);
  });
});

describe("evalSig", () => {
  it("evaluates test direction with rate and severity", () => {
    const sig = { dir: "test" };
    expect(evalSig(sig, { rate: 100, severity: "none" }, 95)).toBe(true);
    expect(evalSig(sig, { rate: 90, severity: "none" }, 95)).toBe(false);
    expect(evalSig(sig, { rate: 100, severity: "P0" }, 95)).toBe(false);
  });
  it("evaluates above/below directions", () => {
    expect(evalSig({ dir: "above" }, 90, 85)).toBe(true);
    expect(evalSig({ dir: "below" }, 2.0, 3.0)).toBe(true);
    expect(evalSig({ dir: "below" }, 4.0, 3.0)).toBe(false);
  });
});

describe("calcV", () => {
  it("passes when the only evaluated signal meets threshold", () => {
    const rel = { rtype: "prompt_update", sigs: { smoke: { rate: 100, severity: "none" } } };
    const thresh = { smoke: 100 };
    const out = calcV(rel, thresh);
    expect(out.ok).toBe(true);
    expect(out.fail).toHaveLength(0);
  });
  it("fails when a present signal misses threshold", () => {
    const rel = { rtype: "prompt_update", sigs: { smoke: { rate: 50, severity: "P1" } } };
    const thresh = { smoke: 100 };
    const out = calcV(rel, thresh);
    expect(out.ok).toBe(false);
    expect(out.fail.some((f) => f.id === "smoke")).toBe(true);
  });
});

describe("fmt", () => {
  it("formats waived and units", () => {
    expect(fmt({ dir: "above", unit: "%" }, null)).toBe("WAIVED");
    expect(fmt({ dir: "above", unit: "%" }, 91.234)).toBe("91.2%");
    expect(fmt({ dir: "below", unit: "ms" }, 218.7)).toBe("219ms");
  });
});

describe("applyAISuggestionsToThresh", () => {
  it("overlays known suggestion keys onto an existing map", () => {
    const base = { accuracy: 80, smoke: 100 };
    const next = applyAISuggestionsToThresh(base);
    expect(next.smoke).toBe(100);
    expect(next.accuracy).toBe(87);
  });
});
