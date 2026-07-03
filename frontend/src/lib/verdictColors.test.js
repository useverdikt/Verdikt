import { describe, it, expect } from "vitest";
import { verdictChartDotColor } from "./verdictColors.js";
import { C } from "../theme/tokens.js";

describe("verdictChartDotColor", () => {
  it("uses amber for COLLECTING releases", () => {
    expect(verdictChartDotColor("collecting")).toBe(C.amber);
    expect(verdictChartDotColor("COLLECTING")).toBe(C.amber);
  });

  it("uses green only for certified releases", () => {
    expect(verdictChartDotColor("certified")).toBe(C.green);
    expect(verdictChartDotColor("CERTIFIED")).toBe(C.green);
  });

  it("uses red for uncertified and amber for override", () => {
    expect(verdictChartDotColor("uncertified")).toBe(C.red);
    expect(verdictChartDotColor("overridden")).toBe(C.amber);
  });
});
