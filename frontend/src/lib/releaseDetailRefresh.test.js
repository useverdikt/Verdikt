import { describe, expect, it } from "vitest";
import { mergeReleaseIntoList } from "./releaseDetailRefresh.js";

describe("mergeReleaseIntoList", () => {
  it("merges mapped detail by backendReleaseId and preserves local id", () => {
    const prev = [{ id: "rc-local", backendReleaseId: "rel_1", status: "collecting", version: "v1" }];
    const mapped = {
      id: "rc-other",
      backendReleaseId: "rel_1",
      status: "certified",
      intelligence: { recommendation: { confidence_score: 82 } }
    };
    const next = mergeReleaseIntoList(prev, mapped);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("rc-local");
    expect(next[0].status).toBe("certified");
    expect(next[0].intelligence.recommendation.confidence_score).toBe(82);
  });
});
