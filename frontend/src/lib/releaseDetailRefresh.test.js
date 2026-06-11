import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  mergeReleaseIntoList,
  mergeListStubsWithExisting,
  isReleaseDetailPending,
  releaseIdsNeedingDetail,
  coalesceReleaseDetailFetch,
  _resetReleaseDetailFetchStateForTests
} from "./releaseDetailRefresh.js";

vi.mock("./apiClient.js", () => ({
  apiGet: vi.fn()
}));

import { apiGet } from "./apiClient.js";

describe("mergeReleaseIntoList", () => {
  it("merges mapped detail by backendReleaseId and preserves local id", () => {
    const prev = [{ id: "rc-local", backendReleaseId: "rel_1", status: "collecting", version: "v1" }];
    const mapped = {
      id: "rc-other",
      backendReleaseId: "rel_1",
      status: "certified",
      detailLoaded: true,
      intelligence: { recommendation: { confidence_score: 82 } }
    };
    const next = mergeReleaseIntoList(prev, mapped);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("rc-local");
    expect(next[0].status).toBe("certified");
    expect(next[0].detailLoaded).toBe(true);
    expect(next[0].intelligence.recommendation.confidence_score).toBe(82);
  });
});

describe("mergeListStubsWithExisting", () => {
  it("preserves hydrated detail when list re-syncs", () => {
    const prev = [
      {
        id: "rc-a",
        backendReleaseId: "rel_a",
        detailLoaded: true,
        signals: { accuracy: 0.91 },
        version: "v1-old"
      }
    ];
    const stubs = [
      {
        id: "rc-a2",
        backendReleaseId: "rel_a",
        detailLoaded: false,
        signals: {},
        version: "v1-new",
        status: "certified"
      }
    ];
    const merged = mergeListStubsWithExisting(prev, stubs);
    expect(merged[0].signals.accuracy).toBe(0.91);
    expect(merged[0].version).toBe("v1-new");
    expect(merged[0].detailLoaded).toBe(true);
  });
});

describe("isReleaseDetailPending", () => {
  it("treats detailLoaded false as pending", () => {
    expect(isReleaseDetailPending({ backendReleaseId: "rel_1", detailLoaded: false })).toBe(true);
  });

  it("treats hydrated rows as not pending", () => {
    expect(isReleaseDetailPending({ backendReleaseId: "rel_1", detailLoaded: true })).toBe(false);
  });
});

describe("releaseIdsNeedingDetail", () => {
  it("prioritizes newest pending ids first", () => {
    const releases = [
      { backendReleaseId: "rel_old", detailLoaded: false },
      { backendReleaseId: "rel_mid", detailLoaded: true },
      { backendReleaseId: "rel_new", detailLoaded: false }
    ];
    expect(releaseIdsNeedingDetail(releases, { priorityCount: 1 })).toEqual(["rel_new", "rel_old"]);
  });
});

describe("coalesceReleaseDetailFetch", () => {
  beforeEach(() => {
    _resetReleaseDetailFetchStateForTests();
    vi.mocked(apiGet).mockReset();
  });

  it("dedupes concurrent fetches for the same release id", async () => {
    vi.mocked(apiGet).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                release: { id: "rel_1", status: "CERTIFIED", version: "v1" },
                signals: []
              }),
            20
          );
        })
    );

    const navigate = vi.fn();
    const [a, b] = await Promise.all([
      coalesceReleaseDetailFetch("rel_1", navigate),
      coalesceReleaseDetailFetch("rel_1", navigate)
    ]);

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a?.backendReleaseId).toBe("rel_1");
  });
});
