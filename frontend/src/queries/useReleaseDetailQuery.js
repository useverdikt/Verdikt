import { useQuery } from "@tanstack/react-query";
import { getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { appQueryClient } from "./queryClient.js";
import { workspaceKeys } from "./workspaceKeys.js";
import { fetchReleaseDetailMapped, fetchReleaseSummaryMapped } from "./workspaceFetchers.js";

/**
 * Thin selector over TanStack cache for a single release detail.
 * Prefer expanding-row hydration for list UX; use this when a component
 * only needs one release and should share cache with the hydration pool.
 */
export function useReleaseDetailQuery(releaseId, { navigate, enabled = true } = {}) {
  const wsId = getWorkspaceId();
  return useQuery({
    queryKey: workspaceKeys.releaseDetail(wsId, releaseId),
    queryFn: () => fetchReleaseDetailMapped(releaseId, navigate),
    enabled: Boolean(hasBackend() && enabled && wsId && releaseId),
    staleTime: 30_000
  });
}

/** Imperative detail fetch through the shared query cache (same keys as hydration pool). */
export async function fetchReleaseDetailQuery(releaseId, navigate, { force = false } = {}) {
  const wsId = getWorkspaceId();
  if (!wsId || !releaseId) return null;
  const queryKey = workspaceKeys.releaseDetail(wsId, releaseId);
  if (force) {
    await appQueryClient.invalidateQueries({ queryKey });
  }
  return appQueryClient.fetchQuery({
    queryKey,
    queryFn: () => fetchReleaseDetailMapped(releaseId, navigate),
    staleTime: 30_000
  });
}

export async function fetchReleaseSummaryQuery(releaseId, navigate, { force = false } = {}) {
  const wsId = getWorkspaceId();
  if (!wsId || !releaseId) return null;
  const queryKey = workspaceKeys.releaseSummary(wsId, releaseId);
  if (force) {
    await appQueryClient.invalidateQueries({ queryKey });
  }
  return appQueryClient.fetchQuery({
    queryKey,
    queryFn: () => fetchReleaseSummaryMapped(releaseId, navigate),
    staleTime: 60_000
  });
}
