import { describe, it, expect } from "vitest";
import { briefBlockerLines, gateActionTone } from "./releaseBriefApi.js";

describe("gateActionTone", () => {
  it("maps gate actions to visual tones", () => {
    expect(gateActionTone("merge")).toBe("ok");
    expect(gateActionTone("collecting")).toBe("info");
    expect(gateActionTone("self_heal")).toBe("warn");
    expect(gateActionTone("recover_certification")).toBe("warn");
    expect(gateActionTone("escalate")).toBe("bad");
    expect(gateActionTone("unknown")).toBe("neutral");
  });
});

describe("briefBlockerLines", () => {
  it("formats signal blockers with optional next steps", () => {
    const lines = briefBlockerLines(
      [
        { signal_id: "accuracy", message: "below min", next_step: "Re-run evals" },
        { type: "missing_required", message: "latency not posted" },
        { message: "extra" }
      ],
      2
    );
    expect(lines).toEqual([
      { line: "accuracy: below min", nextStep: "Re-run evals" },
      { line: "missing_required: latency not posted", nextStep: null }
    ]);
  });

  it("returns empty for non-arrays", () => {
    expect(briefBlockerLines(null)).toEqual([]);
  });
});
