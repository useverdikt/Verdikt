import { appQueryClient } from "./queryClient.js";
import { workspaceKeys } from "./workspaceKeys.js";

/** Drop all cached reads for a workspace. */
export function invalidateWorkspaceQueries(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && key[0] === "workspace" && key[1] === wsId;
    }
  });
}

export function invalidateWorkspaceThresholds(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({ queryKey: workspaceKeys.thresholds(wsId) });
}

export function invalidateWorkspaceReleases(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && key[0] === "workspace" && key[1] === wsId && key[2] === "releases";
    }
  });
}

export function invalidateWorkspaceAudit(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && key[0] === "workspace" && key[1] === wsId && key[2] === "audit";
    }
  });
}

export function invalidateWorkspaceSignalDefinitions(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({ queryKey: workspaceKeys.signalDefinitions(wsId) });
}

export { workspaceKeys };
