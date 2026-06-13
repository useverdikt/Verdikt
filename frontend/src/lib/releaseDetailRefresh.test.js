import { describe, expect, it } from "vitest";
import {
  mergeReleaseIntoList,
  mergeListStubsWithExisting,
  isReleaseDetailPending,
  isSummaryPending,
  releaseIdsNeedingDetail,
  chartWindowPendingIds,
  allPendingReleaseIds,
  pendingSummaryIdsForReleases,
  initialReleaseTablePendingIds,
  RELEASE_TABLE_INITIAL_HYDRATE
} from "./releaseDetailRefresh.js";

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
  it("treats summary-only rows as pending full detail", () => {
    expect(isReleaseDetailPending({ backendReleaseId: "rel_1", summaryLoaded: true, detailLoaded: false })).toBe(true);
  });

  it("treats fully hydrated rows as not pending", () => {
    expect(isReleaseDetailPending({ backendReleaseId: "rel_1", detailLoaded: true })).toBe(false);
  });
});

describe("isSummaryPending", () => {
  it("treats summaryLoaded rows as not pending", () => {
    expect(isSummaryPending({ backendReleaseId: "rel_1", summaryLoaded: true, detailLoaded: false })).toBe(false);
  });

  it("treats stubs without signals as pending", () => {
    expect(isSummaryPending({ backendReleaseId: "rel_1", detailLoaded: false, signals: {} })).toBe(true);
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

describe("chartWindowPendingIds", () => {
  it("returns only summary-pending ids from the chart window slice", () => {
    const releases = Array.from({ length: 5 }, (_, i) => ({
      backendReleaseId: `rel_${i}`,
      summaryLoaded: i < 3,
      detailLoaded: i < 3
    }));
    expect(chartWindowPendingIds(releases, 2)).toEqual(["rel_3", "rel_4"]);
    expect(allPendingReleaseIds(releases)).toEqual(["rel_3", "rel_4"]);
  });
});

describe("pendingSummaryIdsForReleases", () => {
  it("returns pending ids only for the given backend id subset", () => {
    const releases = [
      { backendReleaseId: "rel_a", summaryLoaded: false, signals: {} },
      { backendReleaseId: "rel_b", summaryLoaded: true, detailLoaded: false },
      { backendReleaseId: "rel_c", summaryLoaded: false, signals: {} }
    ];
    expect(pendingSummaryIdsForReleases(releases, ["rel_a", "rel_b"])).toEqual(["rel_a"]);
  });
});

describe("initialReleaseTablePendingIds", () => {
  it("caps initial hydration to the configured limit", () => {
    const releases = Array.from({ length: 30 }, (_, i) => ({
      backendReleaseId: `rel_${i}`,
      summaryLoaded: false,
      signals: {}
    }));
    expect(initialReleaseTablePendingIds(releases)).toHaveLength(RELEASE_TABLE_INITIAL_HYDRATE);
    expect(initialReleaseTablePendingIds(releases, { limit: 5 })).toHaveLength(5);
  });
});
