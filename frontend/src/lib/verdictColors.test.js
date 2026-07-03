import { describe, it, expect } from "vitest";
import { verdictChartDotColor, VERDICT_PALETTE, verdictPassFailColor, verdictStatusColor } from "./verdictColors.js";
import { C } from "../theme/tokens.js";
import { UI_RELEASE_STATUS } from "./releaseStatus.js";

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

describe("VERDICT_PALETTE", () => {
  it("maps all UI release statuses to token colors", () => {
    expect(VERDICT_PALETTE[UI_RELEASE_STATUS.CERTIFIED].fg).toBe(C.green);
    expect(VERDICT_PALETTE[UI_RELEASE_STATUS.UNCERTIFIED].fg).toBe(C.red);
    expect(verdictStatusColor("CERTIFIED")).toBe(C.green);
  });

  it("pass/fail helper uses green and red", () => {
    expect(verdictPassFailColor(true)).toBe(C.green);
    expect(verdictPassFailColor(false)).toBe(C.red);
  });
});
