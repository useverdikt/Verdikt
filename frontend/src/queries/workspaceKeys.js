/** TanStack Query keys for workspace-scoped API resources. */
export const workspaceKeys = {
  root: ["workspace"],
  workspace: (wsId) => [...workspaceKeys.root, wsId],
  thresholds: (wsId) => [...workspaceKeys.workspace(wsId), "thresholds"],
  releases: (wsId, params = {}) => [...workspaceKeys.workspace(wsId), "releases", params],
  audit: (wsId, params = {}) => [...workspaceKeys.workspace(wsId), "audit", params],
  signalDefinitions: (wsId) => [...workspaceKeys.workspace(wsId), "signal-definitions"]
};
