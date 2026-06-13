import { createWorkspaceResourceCache } from "./workspaceResourceCache.js";

const { getCached, fetch, reset } = createWorkspaceResourceCache({
  pathFor: (wsId) => `/api/workspaces/${wsId}/loop-readiness`
});

export const getCachedLoopReadiness = getCached;
export const fetchLoopReadiness = fetch;
export const resetLoopReadinessCache = reset;
