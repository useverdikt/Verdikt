import { describe, expect, it } from "vitest";
import { workspaceKeys } from "./workspaceKeys.js";

describe("workspaceKeys", () => {
  it("scopes keys by workspace id", () => {
    expect(workspaceKeys.thresholds("ws_a")).toEqual(["workspace", "ws_a", "thresholds"]);
    expect(workspaceKeys.releases("ws_a", { limit: 50 })).toEqual([
      "workspace",
      "ws_a",
      "releases",
      { limit: 50 }
    ]);
  });

  it("uses distinct keys for different workspaces", () => {
    expect(workspaceKeys.audit("ws_a", { limit: 50 })).not.toEqual(
      workspaceKeys.audit("ws_b", { limit: 50 })
    );
  });

  it("nests release summary and detail under releaseRoot", () => {
    expect(workspaceKeys.releaseRoot("ws_a", "rel_1")).toEqual(["workspace", "ws_a", "release", "rel_1"]);
    expect(workspaceKeys.releaseSummary("ws_a", "rel_1")).toEqual([
      "workspace",
      "ws_a",
      "release",
      "rel_1",
      "summary"
    ]);
    expect(workspaceKeys.releaseDetail("ws_a", "rel_1")).toEqual([
      "workspace",
      "ws_a",
      "release",
      "rel_1",
      "detail"
    ]);
  });

  it("keeps list pages under releasesRoot", () => {
    expect(workspaceKeys.releasesRoot("ws_a")).toEqual(["workspace", "ws_a", "releases"]);
    expect(workspaceKeys.releases("ws_a", { limit: 50, before: "t" })[2]).toBe("releases");
  });
});
