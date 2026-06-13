import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../lib/apiClient.js";
import { fetchLoopReadiness, getCachedLoopReadiness, resetLoopReadinessCache } from "../lib/loopReadinessCache.js";

/** Shared loop-readiness fetch with SWR cache — used by Intelligence Hub and Release side panel. */
export function useLoopReadiness(wsId, { enabled = true } = {}) {
  const [data, setData] = useState(() => (enabled && wsId ? getCachedLoopReadiness(wsId) : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(
    async ({ force = false } = {}) => {
      if (!enabled || !wsId) return null;
      if (force) resetLoopReadinessCache(wsId);
      setLoading(true);
      setError(null);
      try {
        const result = await fetchLoopReadiness(wsId, apiGet);
        setData(result);
        return result;
      } catch (err) {
        setError(err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [wsId, enabled]
  );

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  return { data, loading, error, reload };
}
