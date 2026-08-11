import { describe, expect, it } from "vitest";
import {
  mergeReleaseIntoList,
  mergeListStubsWithExisting,
  isReleaseDetailPending,
  isSummaryPending,
  chartWindowPendingIds,
  allPendingReleaseIds,
  pendingSummaryIdsForReleases,
  initialReleaseTablePendingIds,
  RELEASE_TABLE_INITIAL_HYDRATE,
  projectReleaseForList
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

describe("projectReleaseForList", () => {
  it("keeps list fields but removes query-owned full detail", () => {
    const projected = projectReleaseForList({
      backendReleaseId: "rel_1",
      status: "certified",
      signals: { accuracy: 92 },
      overrideBy: "CTO",
      intelligence: { verdict: { summary: "detail" } },
      certification: { summary: "certificate" },
      release_deltas: [{ signal_id: "accuracy" }],
      detailLoaded: true,
      summaryLoaded: true
    });

    expect(projected.status).toBe("certified");
    expect(projected.signals.accuracy).toBe(92);
    expect(projected.overrideBy).toBeUndefined();
    expect(projected.overrideReason).toBeUndefined();
    expect(projected.intelligence).toBeUndefined();
    expect(projected.certification).toBeUndefined();
    expect(projected.release_deltas).toBeUndefined();
    expect(projected.detailLoaded).toBe(false);
    expect(projected.summaryLoaded).toBe(true);
  });

  it("clears previously merged full detail when updating a list row", () => {
    const next = mergeReleaseIntoList(
      [
        {
          id: "rc-local",
          backendReleaseId: "rel_1",
          intelligence: { verdict: { summary: "old local detail" } },
          release_deltas: [{ signal_id: "accuracy" }],
          detailLoaded: true
        }
      ],
      projectReleaseForList({
        backendReleaseId: "rel_1",
        status: "certified",
        signals: { accuracy: 95 },
        detailLoaded: true
      })
    );

    expect(next[0].intelligence).toBeUndefined();
    expect(next[0].release_deltas).toBeUndefined();
    expect(next[0].detailLoaded).toBe(false);
  });
});

describe("mergeListStubsWithExisting", () => {
  it("preserves hydrated summary signals when list re-syncs", () => {
    const prev = [
      {
        id: "rc-a",
        backendReleaseId: "rel_a",
        detailLoaded: false,
        summaryLoaded: true,
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
    expect(merged[0].detailLoaded).toBe(false);
    expect(merged[0].summaryLoaded).toBe(true);
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

describe("chartWindowPendingIds", () => {
  it("returns pending ids from the same newest-first window as TrendView", () => {
    // API list is newest-first (index 0 = newest).
    const releases = Array.from({ length: 5 }, (_, i) => ({
      backendReleaseId: `rel_${i}`,
      summaryLoaded: false,
      detailLoaded: false,
      signals: {}
    }));
    // Window of 2 → newest two releases (rel_0, rel_1).
    expect(chartWindowPendingIds(releases, 2)).toEqual(["rel_1", "rel_0"]);
  });

  it("skips already-hydrated rows in the chart window", () => {
    const releases = Array.from({ length: 5 }, (_, i) => ({
      backendReleaseId: `rel_${i}`,
      summaryLoaded: i >= 2,
      detailLoaded: i >= 2,
      signals: i >= 2 ? { smoke: 1 } : {}
    }));
    expect(chartWindowPendingIds(releases, 2)).toEqual(["rel_1", "rel_0"]);
    expect(allPendingReleaseIds(releases)).toEqual(["rel_0", "rel_1"]);
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
