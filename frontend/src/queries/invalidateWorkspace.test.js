import { describe, it, expect, vi, beforeEach } from "vitest";
import { appQueryClient } from "./queryClient.js";
import {
  invalidateWorkspaceAudit,
  invalidateWorkspaceQueries,
  invalidateWorkspaceReleases,
  invalidateWorkspaceThresholds
} from "./invalidateWorkspace.js";
import { workspaceKeys } from "./workspaceKeys.js";

describe("invalidateWorkspaceQueries", () => {
  beforeEach(() => {
    vi.spyOn(appQueryClient, "invalidateQueries").mockResolvedValue(undefined);
  });

  it("invalidates all queries under a workspace prefix", async () => {
    await invalidateWorkspaceQueries("ws_demo");
    expect(appQueryClient.invalidateQueries).toHaveBeenCalledWith({
      predicate: expect.any(Function)
    });
    const { predicate } = appQueryClient.invalidateQueries.mock.calls[0][0];
    expect(predicate({ queryKey: workspaceKeys.thresholds("ws_demo") })).toBe(true);
    expect(predicate({ queryKey: workspaceKeys.releases("ws_demo", { limit: 50 }) })).toBe(true);
    expect(predicate({ queryKey: workspaceKeys.thresholds("ws_other") })).toBe(false);
  });
});

describe("scoped workspace invalidators", () => {
  beforeEach(() => {
    vi.spyOn(appQueryClient, "invalidateQueries").mockResolvedValue(undefined);
  });

  it("invalidateWorkspaceThresholds targets thresholds key only", async () => {
    await invalidateWorkspaceThresholds("ws_demo");
    expect(appQueryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: workspaceKeys.thresholds("ws_demo")
    });
  });

  it("invalidateWorkspaceReleases matches releases subkeys", async () => {
    await invalidateWorkspaceReleases("ws_demo");
    const { predicate } = appQueryClient.invalidateQueries.mock.calls[0][0];
    expect(predicate({ queryKey: workspaceKeys.releases("ws_demo", { limit: 50 }) })).toBe(true);
    expect(predicate({ queryKey: workspaceKeys.thresholds("ws_demo") })).toBe(false);
  });

  it("invalidateWorkspaceAudit matches audit subkeys", async () => {
    await invalidateWorkspaceAudit("ws_demo");
    const { predicate } = appQueryClient.invalidateQueries.mock.calls[0][0];
    expect(predicate({ queryKey: workspaceKeys.audit("ws_demo", { limit: 50 }) })).toBe(true);
    expect(predicate({ queryKey: workspaceKeys.releases("ws_demo") })).toBe(false);
  });
});
