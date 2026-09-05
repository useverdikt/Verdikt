import { describe, it, expect } from "vitest";
import { matchReleaseByQueryId, readReleaseFocusId } from "./releaseFocusQuery.js";

describe("releaseFocusQuery", () => {
  const releases = [
    { id: "rc-relabc", backendReleaseId: "rel_abc", version: "v1" },
    { id: "rc-reldef", backendReleaseId: "rel_def", version: "v2" }
  ];

  it("matches the backend release id from VCS / gate hub_links", () => {
    expect(matchReleaseByQueryId(releases, "rel_abc")?.id).toBe("rc-relabc");
  });

  it("also accepts the UI row id", () => {
    expect(matchReleaseByQueryId(releases, "rc-reldef")?.backendReleaseId).toBe("rel_def");
  });

  it("returns null for missing or blank ids", () => {
    expect(matchReleaseByQueryId(releases, "")).toBe(null);
    expect(matchReleaseByQueryId(releases, "rel_missing")).toBe(null);
    expect(matchReleaseByQueryId([], "rel_abc")).toBe(null);
  });

  it("reads ?release= from search params", () => {
    expect(readReleaseFocusId(new URLSearchParams("release=rel_abc"))).toBe("rel_abc");
    expect(readReleaseFocusId(new URLSearchParams(""))).toBe(null);
  });
});
