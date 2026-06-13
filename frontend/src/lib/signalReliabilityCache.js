import { createWorkspaceResourceCache } from "./workspaceResourceCache.js";

const { getCached, fetch, reset } = createWorkspaceResourceCache({
  pathFor: (wsId) => `/api/workspaces/${wsId}/signal-reliability`
});

export const getCachedSignalReliability = getCached;
export const fetchSignalReliability = fetch;
export const resetSignalReliabilityCache = reset;
