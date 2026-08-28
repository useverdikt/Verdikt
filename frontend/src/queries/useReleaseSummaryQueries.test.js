import { describe, expect, it, beforeEach } from "vitest";
import { appQueryClient } from "./queryClient.js";
import { workspaceKeys } from "./workspaceKeys.js";
import {
  overlayReleasesWithQuerySummaries,
  releaseSummaryQueryOptions,
  uniqueReleaseIds,
  RELEASE_SUMMARY_STALE_MS
} from "./useReleaseSummaryQueries.js";

describe("uniqueReleaseIds", () => {
  it("drops blanks and duplicates while preserving first-seen order", () => {
    expect(uniqueReleaseIds(["rel_b", "", "rel_a", "rel_b", null, "rel_c"])).toEqual([
      "rel_b",
      "rel_a",
      "rel_c"
    ]);
  });
});

describe("releaseSummaryQueryOptions", () => {
  it("uses the workspace-scoped summary key and bounded freshness", () => {
    const options = releaseSummaryQueryOptions("ws_a", "rel_1", null);
    expect(options.queryKey).toEqual(["workspace", "ws_a", "release", "rel_1", "summary"]);
    expect(options.enabled).toBe(true);
    expect(options.staleTime).toBe(RELEASE_SUMMARY_STALE_MS);
    expect(options.retry).toBe(2);
  });

  it("disables fetches when workspace or release identity is missing", () => {
    expect(releaseSummaryQueryOptions(null, "rel_1", null).enabled).toBe(false);
    expect(releaseSummaryQueryOptions("ws_a", null, null).enabled).toBe(false);
  });
});

describe("overlayReleasesWithQuerySummaries", () => {
  beforeEach(() => {
    appQueryClient.clear();
  });

  it("prefers in-flight query results then falls back to the TanStack cache", () => {
    appQueryClient.setQueryData(workspaceKeys.releaseSummary("ws_a", "rel_cached"), {
      backendReleaseId: "rel_cached",
      signals: { smoke: 88 },
      summaryLoaded: true
    });

    const next = overlayReleasesWithQuerySummaries(
      [
        { backendReleaseId: "rel_live", status: "collecting", signals: {} },
        { backendReleaseId: "rel_cached", status: "certified", signals: {} }
      ],
      {
        byId: {
          rel_live: { backendReleaseId: "rel_live", signals: { accuracy: 90 }, summaryLoaded: true }
        },
        failedIds: []
      },
      "ws_a"
    );

    expect(next[0].signals.accuracy).toBe(90);
    expect(next[1].signals.smoke).toBe(88);
    expect(next[1].status).toBe("certified");
  });

  it("marks failed ids loaded without copying a summary", () => {
    const next = overlayReleasesWithQuerySummaries(
      [{ backendReleaseId: "rel_fail", signals: {}, summaryLoaded: false }],
      { byId: {}, failedIds: ["rel_fail"] },
      "ws_a"
    );
    expect(next[0].summaryLoaded).toBe(true);
    expect(next[0].signals).toEqual({});
  });
});
