import { apiGet } from "./apiClient.js";
import { mapBackendDetailToUi } from "../app/main/appMainLogic.js";

export const RELEASE_UPDATED_EVENT = "verdikt:release-updated";

/** Fetch full release detail and map to UI release shape. */
export async function fetchAndMapReleaseDetail(backendReleaseId, navigate) {
  const detail = await apiGet(`/api/releases/${backendReleaseId}`, { navigate });
  return mapBackendDetailToUi(detail);
}

/** Notify other views (e.g. release dashboard) that a release row changed. */
export function emitReleaseUpdated(mapped) {
  if (typeof window === "undefined" || !mapped) return;
  window.dispatchEvent(new CustomEvent(RELEASE_UPDATED_EVENT, { detail: mapped }));
}

/** Merge mapped detail into a releases array, preserving local row id. */
export function mergeReleaseIntoList(releases, mapped) {
  if (!mapped?.backendReleaseId) return releases;
  const ix = releases.findIndex(
    (r) => r.backendReleaseId === mapped.backendReleaseId || r.id === mapped.id
  );
  if (ix >= 0) {
    const next = [...releases];
    next[ix] = { ...next[ix], ...mapped, id: releases[ix].id };
    return next;
  }
  return [mapped, ...releases];
}

/** Fetch detail, optionally broadcast, return mapped release. */
export async function refreshReleaseDetail(backendReleaseId, navigate, { emit = true } = {}) {
  const mapped = await fetchAndMapReleaseDetail(backendReleaseId, navigate);
  if (emit) emitReleaseUpdated(mapped);
  return mapped;
}
