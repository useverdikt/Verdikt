import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { getWorkspaceId } from "../lib/apiClient.js";
import { fetchAndMapReleaseSummary } from "../lib/releaseDetailApi.js";
import { hasBackend } from "../lib/hasBackend.js";
import { overlayReleaseSummaries } from "../lib/releaseDetailRefresh.js";
import { appQueryClient } from "./queryClient.js";
import { workspaceKeys } from "./workspaceKeys.js";

export const RELEASE_SUMMARY_STALE_MS = 60_000;

export function uniqueReleaseIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function releaseSummaryQueryOptions(wsId, releaseId, navigate, { enabled = true } = {}) {
  return {
    queryKey: workspaceKeys.releaseSummary(wsId, releaseId),
    queryFn: () => fetchAndMapReleaseSummary(releaseId, navigate),
    enabled: Boolean(enabled && wsId && releaseId),
    staleTime: RELEASE_SUMMARY_STALE_MS,
    retry: 2
  };
}

export function overlayReleasesWithQuerySummaries(releases, bundle, wsId) {
  const map = new Map();
  for (const [id, data] of Object.entries(bundle?.byId || {})) {
    if (data) map.set(id, data);
  }
  const failed = new Set(bundle?.failedIds || []);
  for (const release of releases || []) {
    const id = release.backendReleaseId;
    if (!id || map.has(id)) continue;
    const cached =
      appQueryClient.getQueryData(workspaceKeys.releaseSummary(wsId, id)) ||
      appQueryClient.getQueryData(workspaceKeys.releaseDetail(wsId, id));
    if (cached) map.set(id, cached);
  }
  return overlayReleaseSummaries(releases, map, failed);
}

export function useReleaseSummaryQueries(releaseIds, navigate, { enabled = true } = {}) {
  const wsId = getWorkspaceId();
  const ids = uniqueReleaseIds(releaseIds);
  const backendEnabled = enabled && hasBackend();
  return useQueries({
    queries: ids.map((id) =>
      releaseSummaryQueryOptions(wsId, id, navigate, { enabled: backendEnabled })
    ),
    combine: (results) => ({
      byId: Object.fromEntries(results.flatMap((result, i) => (result.data ? [[ids[i], result.data]] : []))),
      failedIds: results.flatMap((result, i) => (result.isError && !result.data ? [ids[i]] : []))
    })
  });
}

export function useOverlaidReleaseSummaries(releases, summaryIds, navigate) {
  const wsId = getWorkspaceId();
  const bundle = useReleaseSummaryQueries(summaryIds, navigate);
  return useMemo(
    () => overlayReleasesWithQuerySummaries(releases, bundle, wsId),
    [releases, bundle, wsId]
  );
}
