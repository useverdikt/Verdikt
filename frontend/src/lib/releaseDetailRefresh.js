import { apiGet } from "./apiClient.js";
import { mapBackendDetailToUi } from "../app/main/appMainLogic.js";

export const RELEASE_UPDATED_EVENT = "verdikt:release-updated";

const DEFAULT_HYDRATE_CONCURRENCY = 6;

/** In-flight detail fetches keyed by backend release id (dedupes expand + background hydration). */
const detailFetchInFlight = new Map();

/** Whether a release row still needs a full detail fetch. */
export function isReleaseDetailPending(release) {
  if (!release?.backendReleaseId) return false;
  if (release.detailLoaded === true) return false;
  if (release.detailLoaded === false) return true;
  // Legacy rows without the flag: pending only when no signal values are present.
  return !Object.values(release.signals || {}).some((v) => v != null);
}

/** Merge list API stubs with already-hydrated rows so re-sync does not wipe detail. */
export function mergeListStubsWithExisting(prev, stubs) {
  const prevByBackend = new Map(prev.map((r) => [r.backendReleaseId, r]));
  return stubs.map((stub) => {
    const existing = prevByBackend.get(stub.backendReleaseId);
    if (existing?.detailLoaded) {
      return {
        ...existing,
        version: stub.version,
        status: stub.status,
        date: stub.date,
        releaseType: stub.releaseType,
        environment: stub.environment,
        evidenceQuality: stub.evidenceQuality ?? existing.evidenceQuality,
        created_at: stub.created_at ?? existing.created_at,
        updated_at: stub.updated_at ?? existing.updated_at,
        verdict_issued_at: stub.verdict_issued_at ?? existing.verdict_issued_at,
        collection_deadline: stub.collection_deadline ?? existing.collection_deadline
      };
    }
    return stub;
  });
}

/** Ids from the newest end of the list that still need detail (for trend chart priority). */
export function releaseIdsNeedingDetail(releases, { priorityCount = 0 } = {}) {
  const pending = releases.filter(isReleaseDetailPending).map((r) => r.backendReleaseId);
  if (!priorityCount || pending.length <= 1) return pending;

  const prioritySet = new Set(
    [...releases]
      .slice(-priorityCount)
      .map((r) => r.backendReleaseId)
      .filter(Boolean)
  );
  const priority = pending.filter((id) => prioritySet.has(id));
  const rest = pending.filter((id) => !prioritySet.has(id));
  return [...priority, ...rest];
}

/** Fetch full release detail and map to UI release shape. */
export async function fetchAndMapReleaseDetail(backendReleaseId, navigate) {
  const detail = await apiGet(`/api/releases/${backendReleaseId}`, { navigate });
  return mapBackendDetailToUi(detail);
}

/**
 * Idempotent detail fetch — concurrent callers share one in-flight request per release id.
 * @param {boolean} [opts.force] — bypass in-flight coalescing (explicit refresh)
 */
export async function coalesceReleaseDetailFetch(backendReleaseId, navigate, { force = false } = {}) {
  if (!backendReleaseId) return null;

  if (!force && detailFetchInFlight.has(backendReleaseId)) {
    return detailFetchInFlight.get(backendReleaseId);
  }

  const promise = fetchAndMapReleaseDetail(backendReleaseId, navigate)
    .catch(() => null)
    .finally(() => {
      if (detailFetchInFlight.get(backendReleaseId) === promise) {
        detailFetchInFlight.delete(backendReleaseId);
      }
    });

  detailFetchInFlight.set(backendReleaseId, promise);
  return promise;
}

/**
 * Hydrate list stubs with full release detail using bounded concurrency (avoids 50 parallel heavy GETs).
 */
export async function hydrateReleaseDetails(
  backendReleaseIds,
  navigate,
  {
    onEach,
    concurrency = DEFAULT_HYDRATE_CONCURRENCY,
    isCancelled = () => false,
    shouldSkipId = () => false,
    priorityIds = []
  } = {}
) {
  const seen = new Set();
  const queue = [];
  for (const id of [...priorityIds, ...backendReleaseIds]) {
    if (!id || seen.has(id) || shouldSkipId(id)) continue;
    seen.add(id);
    queue.push(id);
  }
  if (!queue.length || !onEach) return;

  async function worker() {
    while (queue.length) {
      if (isCancelled()) return;
      const id = queue.shift();
      if (!id || shouldSkipId(id)) continue;
      const mapped = await coalesceReleaseDetailFetch(id, navigate);
      if (!isCancelled() && mapped) onEach(mapped);
    }
  }

  const n = Math.min(Math.max(1, concurrency), queue.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
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
export async function refreshReleaseDetail(backendReleaseId, navigate, { emit = true, force = true } = {}) {
  const mapped = await coalesceReleaseDetailFetch(backendReleaseId, navigate, { force });
  if (mapped && emit) emitReleaseUpdated(mapped);
  return mapped;
}

/** Test-only: clear in-flight fetch map. */
export function _resetReleaseDetailFetchStateForTests() {
  detailFetchInFlight.clear();
}
