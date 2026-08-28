import { describe, it, expect } from "vitest";
import { missingRecommendedPackIds, adoptMissingLibrarySignals, RECOMMENDED_FIRST_RUN_SIGNAL_IDS } from "./recommendedPack.js";

describe("recommendedPack", () => {
  it("includes the shared default required AI signals", () => {
    expect(RECOMMENDED_FIRST_RUN_SIGNAL_IDS).toEqual(
      expect.arrayContaining(["accuracy", "safety", "tone", "hallucination", "relevance"])
    );
  });

  it("returns only recommended ids that are in the library and not yet adopted", () => {
    const missing = missingRecommendedPackIds(
      ["accuracy", "safety", "tone"],
      [{ signal_id: "accuracy" }],
      [{ signal_id: "accuracy" }, { signal_id: "safety" }]
    );
    expect(missing).toEqual(["safety"]);
  });

  it("adopts missing ids in order", async () => {
    const calls = [];
    await adoptMissingLibrarySignals(["safety", "tone"], async (id) => {
      calls.push(id);
    });
    expect(calls).toEqual(["safety", "tone"]);
  });
});
