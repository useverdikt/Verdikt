/** TanStack Query keys for workspace-scoped API resources. */
export const workspaceKeys = {
  root: ["workspace"],
  workspace: (wsId) => [...workspaceKeys.root, wsId],
  thresholds: (wsId) => [...workspaceKeys.workspace(wsId), "thresholds"],
  /** Prefix for all release list pages (limit/before variants). */
  releasesRoot: (wsId) => [...workspaceKeys.workspace(wsId), "releases"],
  releases: (wsId, params = {}) => [...workspaceKeys.releasesRoot(wsId), params],
  /** Prefix for per-release summary + detail. */
  releaseRoot: (wsId, releaseId) => [...workspaceKeys.workspace(wsId), "release", releaseId],
  releaseSummary: (wsId, releaseId) => [...workspaceKeys.releaseRoot(wsId, releaseId), "summary"],
  releaseDetail: (wsId, releaseId) => [...workspaceKeys.releaseRoot(wsId, releaseId), "detail"],
  audit: (wsId, params = {}) => [...workspaceKeys.workspace(wsId), "audit", params],
  signalDefinitions: (wsId) => [...workspaceKeys.workspace(wsId), "signal-definitions"]
};
