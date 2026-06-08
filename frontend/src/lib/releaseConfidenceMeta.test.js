import { describe, expect, it } from "vitest";
import { confMeta } from "./releaseConfidenceMeta.js";

describe("confMeta", () => {
  it("uses confidence_pct when provided for certified", () => {
    expect(confMeta("certified", 86).pct).toBe(86);
    expect(confMeta("certified", 86).band).toBe("HIGH");
  });

  it("defaults uncertified band when no confidence_pct", () => {
    expect(confMeta("uncertified", undefined)).toMatchObject({ pct: 41, band: "LOW", fill: "lo" });
  });

  it("defaults certified band when no confidence_pct", () => {
    expect(confMeta("certified", undefined)).toMatchObject({ pct: 91, band: "HIGH", fill: "hi" });
  });

  it("maps legacy blocked/shipped aliases", () => {
    expect(confMeta("blocked", undefined).pct).toBe(41);
    expect(confMeta("shipped", undefined).pct).toBe(91);
  });
});
