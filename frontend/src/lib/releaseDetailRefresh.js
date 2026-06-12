import {
  enqueue as enqueueReleaseHydration,
  awaitReleaseDetail,
  reset as resetHydrationPool,
  syncHydratedFromReleases,
  setHydrationNavigate,
  setOnEach
} from "./hydrationPool.js";

export const RELEASE_UPDATED_EVENT = "verdikt:release-updated";

export {
  resetHydrationPool,
  syncHydratedFromReleases,
  setHydrationNavigate,
  setOnEach,
  enqueueReleaseHydration,
  awaitReleaseDetail
};

/** Whether a release row still needs a full detail fetch. */
export function isReleaseDetailPending(release) {
  if (!release?.backendReleaseId) return false;
  if (release.detailLoaded === true) return false;
  if (release.detailLoaded === false) return true;
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

/** All release ids that still need detail hydration. */
export function allPendingReleaseIds(releases) {
  return releases.filter(isReleaseDetailPending).map((r) => r.backendReleaseId);
}

/** Chart-window release ids that still need detail (for trends priority enqueue). */
export function chartWindowPendingIds(releases, windowSize) {
  return [...releases]
    .slice(-windowSize)
    .filter(isReleaseDetailPending)
    .map((r) => r.backendReleaseId);
}

/** @deprecated Use chartWindowPendingIds + enqueue priority instead. */
export function releaseIdsNeedingDetail(releases, { priorityCount = 0 } = {}) {
  const pending = allPendingReleaseIds(releases);
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

/** Fetch detail via the global pool, optionally broadcast, return mapped release. */
export async function refreshReleaseDetail(backendReleaseId, navigate, { emit = true, force = true } = {}) {
  setHydrationNavigate(navigate);
  const mapped = await awaitReleaseDetail(backendReleaseId, { priority: true, force });
  if (mapped && emit) emitReleaseUpdated(mapped);
  return mapped;
}
