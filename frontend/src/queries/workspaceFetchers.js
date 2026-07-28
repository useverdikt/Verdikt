import { apiGet } from "../lib/apiClient.js";
import { fetchAndMapReleaseDetail, fetchAndMapReleaseSummary } from "../lib/releaseDetailApi.js";

export async function fetchWorkspaceThresholds(wsId, navigate) {
  return apiGet(`/api/workspaces/${wsId}/thresholds`, { navigate });
}

export async function fetchWorkspaceReleases(wsId, navigate, { limit = 50, before } = {}) {
  let path = `/api/workspaces/${wsId}/releases?limit=${limit}`;
  if (before) path += `&before=${encodeURIComponent(before)}`;
  return apiGet(path, { navigate });
}

export async function fetchWorkspaceAudit(wsId, navigate, { limit = 50, before } = {}) {
  let path = `/api/workspaces/${wsId}/audit?limit=${limit}`;
  if (before) path += `&before=${encodeURIComponent(before)}`;
  return apiGet(path, { navigate });
}

export async function fetchSignalDefinitions(wsId, navigate) {
  return apiGet(`/api/workspaces/${wsId}/signal-definitions`, { navigate });
}

/** Full release detail (expand / audit / intelligence). */
export async function fetchReleaseDetailMapped(releaseId, navigate) {
  return fetchAndMapReleaseDetail(releaseId, navigate);
}

/** Lightweight summary for list/trend hydration. */
export async function fetchReleaseSummaryMapped(releaseId, navigate) {
  return fetchAndMapReleaseSummary(releaseId, navigate);
}
