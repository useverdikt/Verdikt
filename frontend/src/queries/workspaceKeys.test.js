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
});
