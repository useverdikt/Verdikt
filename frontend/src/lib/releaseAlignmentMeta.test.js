import { describe, expect, it } from "vitest";
import { alignBadgeMeta, hasComputedAlignment, mapBackendAlignmentToUi } from "./releaseAlignmentMeta.js";

describe("releaseAlignmentMeta", () => {
  it("maps backend alignment values to UI slugs", () => {
    expect(mapBackendAlignmentToUi("CORRECT")).toBe("correct");
    expect(mapBackendAlignmentToUi("MISS")).toBe("miss");
    expect(mapBackendAlignmentToUi("OVER_BLOCK")).toBe("uncertified");
    expect(mapBackendAlignmentToUi("UNKNOWN")).toBe("uncertified");
    expect(mapBackendAlignmentToUi(null)).toBe("uncertified");
  });

  it("renders CORRECT, MISS, UNCERTIFIED labels with matching badge classes", () => {
    expect(alignBadgeMeta("correct")).toMatchObject({ cls: "al-c", label: "CORRECT" });
    expect(alignBadgeMeta("miss")).toMatchObject({ cls: "al-m", label: "MISS" });
    expect(alignBadgeMeta("uncertified")).toMatchObject({ cls: "al-u", label: "UNCERTIFIED" });
  });

  it("detects computed alignment loops", () => {
    expect(hasComputedAlignment("correct")).toBe(true);
    expect(hasComputedAlignment("miss")).toBe(true);
    expect(hasComputedAlignment("uncertified")).toBe(false);
  });
});
