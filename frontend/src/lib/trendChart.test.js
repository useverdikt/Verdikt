import { describe, expect, it } from "vitest";
import { TREND_CHART_MAX_POINTS, trendChartWindowReleases } from "./trendChart.js";

describe("trendChartWindowReleases", () => {
  it("returns the newest N releases in chronological order", () => {
    const releases = ["newest", "mid", "oldest"].map((version, i) => ({
      backendReleaseId: `rel_${i}`,
      version
    }));
    expect(trendChartWindowReleases(releases, 2).map((r) => r.version)).toEqual(["mid", "newest"]);
  });

  it("defaults to TREND_CHART_MAX_POINTS", () => {
    const releases = Array.from({ length: TREND_CHART_MAX_POINTS + 5 }, (_, i) => ({
      backendReleaseId: `rel_${i}`
    }));
    expect(trendChartWindowReleases(releases)).toHaveLength(TREND_CHART_MAX_POINTS);
    expect(trendChartWindowReleases(releases)[0].backendReleaseId).toBe("rel_17");
    expect(trendChartWindowReleases(releases).at(-1).backendReleaseId).toBe("rel_0");
  });
});
