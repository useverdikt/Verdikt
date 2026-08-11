import { describe, expect, it } from "vitest";
import {
  RELEASE_DETAIL_STALE_MS,
  mergeReleaseDetailForDisplay,
  releaseDetailQueryOptions
} from "./useReleaseDetailQuery.js";

describe("releaseDetailQueryOptions", () => {
  it("uses the workspace-scoped detail key and bounded freshness", () => {
    const options = releaseDetailQueryOptions("ws_a", "rel_1", null);
    expect(options.queryKey).toEqual([
      "workspace",
      "ws_a",
      "release",
      "rel_1",
      "detail"
    ]);
    expect(options.enabled).toBe(true);
    expect(options.staleTime).toBe(RELEASE_DETAIL_STALE_MS);
  });

  it("disables fetches when workspace or release identity is missing", () => {
    expect(releaseDetailQueryOptions(null, "rel_1", null).enabled).toBe(false);
    expect(releaseDetailQueryOptions("ws_a", null, null).enabled).toBe(false);
  });
});

describe("mergeReleaseDetailForDisplay", () => {
  it("keeps fresh list identity and summary fields while adding query detail", () => {
    const release = mergeReleaseDetailForDisplay(
      {
        id: "rc-local",
        backendReleaseId: "rel_1",
        version: "v2",
        status: "collecting",
        environment: "pre-prod",
        updated_at: "2026-08-12T00:01:00.000Z",
        summaryLoaded: true,
        signals: { accuracy: 95 },
        signalRows: [{ signal_id: "accuracy", value: 95 }]
      },
      {
        id: "rc-query",
        backendReleaseId: "rel_1",
        version: "v1",
        status: "uncertified",
        updated_at: "2026-08-12T00:00:00.000Z",
        signals: { accuracy: 70 },
        signalRows: [{ signal_id: "accuracy", value: 70 }],
        intelligence: { verdict: { summary: "query-owned detail" } },
        detailLoaded: true
      }
    );

    expect(release.id).toBe("rc-local");
    expect(release.version).toBe("v2");
    expect(release.status).toBe("collecting");
    expect(release.signals.accuracy).toBe(95);
    expect(release.intelligence.verdict.summary).toBe("query-owned detail");
    expect(release.detailLoaded).toBe(true);
  });

  it("uses newer query summary fields when detail was fetched after the list", () => {
    const release = mergeReleaseDetailForDisplay(
      {
        id: "rc-local",
        backendReleaseId: "rel_1",
        status: "collecting",
        updated_at: "2026-08-12T00:00:00.000Z",
        summaryLoaded: true,
        signals: { accuracy: 70 }
      },
      {
        backendReleaseId: "rel_1",
        status: "certified",
        updated_at: "2026-08-12T00:01:00.000Z",
        signals: { accuracy: 95 },
        signalRows: [{ signal_id: "accuracy", value: 95 }],
        detailLoaded: true
      }
    );

    expect(release.status).toBe("certified");
    expect(release.signals.accuracy).toBe(95);
  });
});
