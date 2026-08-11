import { appQueryClient } from "./queryClient.js";
import { workspaceKeys } from "./workspaceKeys.js";

function isWorkspaceKey(key, wsId) {
  return Array.isArray(key) && key[0] === "workspace" && key[1] === wsId;
}

/** Drop all cached reads for a workspace. */
export function invalidateWorkspaceQueries(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({
    predicate: (query) => isWorkspaceKey(query.queryKey, wsId)
  });
}

export function invalidateWorkspaceThresholds(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({ queryKey: workspaceKeys.thresholds(wsId) });
}

/** Invalidate release list pages and per-release summary/detail caches. */
export function invalidateWorkspaceReleases(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      if (!isWorkspaceKey(key, wsId)) return false;
      return key[2] === "releases" || key[2] === "release";
    }
  });
}

export function invalidateWorkspaceRelease(wsId, releaseId) {
  if (!wsId || !releaseId) return Promise.resolve();
  return appQueryClient.invalidateQueries({ queryKey: workspaceKeys.releaseRoot(wsId, releaseId) });
}

export function invalidateWorkspaceAudit(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return isWorkspaceKey(key, wsId) && key[2] === "audit";
    }
  });
}

export function invalidateWorkspaceRemediationDebt(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({ queryKey: workspaceKeys.remediationDebt(wsId) });
}

export function invalidateWorkspaceSignalDefinitions(wsId) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({ queryKey: workspaceKeys.signalDefinitions(wsId) });
}

export { workspaceKeys };
