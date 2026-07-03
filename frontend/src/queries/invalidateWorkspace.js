import { appQueryClient } from "./queryClient.js";
import { workspaceKeys } from "./workspaceKeys.js";

/** Drop cached workspace reads so the next fetchQuery hits the network. */
export function invalidateWorkspaceQueries(wsId, { releasesParams = { limit: 50 }, auditParams = { limit: 50 } } = {}) {
  if (!wsId) return Promise.resolve();
  return appQueryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && key[0] === "workspace" && key[1] === wsId;
    }
  });
}

export { workspaceKeys };
