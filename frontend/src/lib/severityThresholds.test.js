import { describe, expect, it } from "vitest";
import {
  severityToIndex,
  showstopperLabelToMaxWorstIndex,
  passesShowstopperGate,
  indexToSeverity
} from "./severityThresholds.js";

describe("severityThresholds", () => {
  it("maps severity labels to indices", () => {
    expect(severityToIndex("none")).toBe(0);
    expect(severityToIndex("P0")).toBe(5);
    expect(indexToSeverity(3)).toBe("P2");
  });

  it("derives max worst index from showstopper policy", () => {
    expect(showstopperLabelToMaxWorstIndex("P0")).toBe(4);
    expect(showstopperLabelToMaxWorstIndex("P1")).toBe(3);
  });

  it("passes when worst defect is below policy block level", () => {
    expect(passesShowstopperGate(severityToIndex("P2"), showstopperLabelToMaxWorstIndex("P1"))).toBe(true);
    expect(passesShowstopperGate(severityToIndex("P0"), showstopperLabelToMaxWorstIndex("P0"))).toBe(false);
    expect(passesShowstopperGate(severityToIndex("none"), showstopperLabelToMaxWorstIndex("P0"))).toBe(true);
  });
});
