import { describe, expect, it } from "vitest";
import { fullLoopBarPct, pipelineFunnelBarPct } from "./loopReadinessUi.js";

describe("loopReadinessUi", () => {
  it("fullLoopBarPct is 100% at or above reliable threshold", () => {
    expect(fullLoopBarPct(10, 10)).toBe(100);
    expect(fullLoopBarPct(11, 10)).toBe(100);
  });

  it("fullLoopBarPct scales below threshold", () => {
    expect(fullLoopBarPct(5, 10)).toBe(50);
    expect(fullLoopBarPct(0, 10)).toBe(0);
  });

  it("pipelineFunnelBarPct caps at 100", () => {
    expect(pipelineFunnelBarPct(11, 15)).toBe(73);
    expect(pipelineFunnelBarPct(19, 19)).toBe(100);
  });
});
