import { describe, expect, it } from "vitest";
import { confMeta } from "./releaseConfidenceMeta.js";

describe("confMeta", () => {
  it("uses explicit confidence when finite", () => {
    expect(confMeta("shipped", 86).pct).toBe(86);
    expect(confMeta("shipped", 86).band).toBe("HIGH");
  });

  it("applies status defaults when confidence is undefined", () => {
    expect(confMeta("blocked", undefined)).toMatchObject({ pct: 41, band: "LOW", fill: "lo" });
    expect(confMeta("overridden", undefined)).toMatchObject({ pct: 68, band: "MEDIUM", fill: "me" });
    expect(confMeta("shipped", undefined)).toMatchObject({ pct: 91, band: "HIGH", fill: "hi" });
  });

  it("treats collecting as awaiting signals", () => {
    expect(confMeta("collecting", undefined)).toMatchObject({
      band: "awaiting signals",
      fill: ""
    });
  });
});
