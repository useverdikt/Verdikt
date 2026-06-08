import { describe, expect, it } from "vitest";
import { confMeta } from "./releaseConfidenceMeta.js";

describe("confMeta", () => {
  it("uses confidence_pct when provided for certified", () => {
    expect(confMeta("certified", 86)).toMatchObject({
      pct: 86,
      displayPct: "86%",
      band: "HIGH",
      fill: "hi"
    });
  });

  it("returns pending layout when no confidence score on finalized release", () => {
    expect(confMeta("uncertified", undefined)).toMatchObject({
      pct: 0,
      displayPct: "—",
      band: "PENDING",
      fill: ""
    });
  });

  it("shows no signals with same layout as scored rows", () => {
    expect(confMeta("certified", undefined, { receivedSignalCount: 0 })).toMatchObject({
      pct: 0,
      displayPct: "—",
      band: "NO SIGNALS",
      fill: "lo"
    });
  });

  it("maps recommendation confidence bands", () => {
    expect(confMeta("certified", 82).band).toBe("HIGH");
    expect(confMeta("certified", 62).band).toBe("MEDIUM");
    expect(confMeta("uncertified", 38).band).toBe("LOW");
  });

  it("uses awaiting layout for collecting releases", () => {
    expect(confMeta("collecting", undefined)).toMatchObject({
      pct: 0,
      displayPct: "—",
      band: "AWAITING",
      fill: ""
    });
  });
});
