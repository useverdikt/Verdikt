import { describe, expect, it } from "vitest";
import { hasComputedAlignment, mapBackendAlignmentToUi } from "./releaseAlignmentMeta.js";

describe("releaseAlignmentMeta", () => {
  it("maps backend alignment values to UI slugs", () => {
    expect(mapBackendAlignmentToUi("CORRECT")).toBe("correct");
    expect(mapBackendAlignmentToUi("MISS")).toBe("miss");
    expect(mapBackendAlignmentToUi("CAUTIOUS")).toBe("uncertified");
    expect(mapBackendAlignmentToUi("UNKNOWN")).toBe("uncertified");
    expect(mapBackendAlignmentToUi(null)).toBe("uncertified");
  });

  it("detects computed alignment loops", () => {
    expect(hasComputedAlignment("correct")).toBe(true);
    expect(hasComputedAlignment("miss")).toBe(true);
    expect(hasComputedAlignment("uncertified")).toBe(false);
  });
});
