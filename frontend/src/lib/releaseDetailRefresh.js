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

/** Whether a release row still needs summary hydration (signals for trends/list). */
export function isSummaryPending(release) {
  if (!release?.backendReleaseId) return false;
  if (release.summaryLoaded || release.detailLoaded) return false;
  return !Object.values(release.signals || {}).some((v) => v != null);
}

/** Whether a release row still needs a full detail fetch (expand, audit, intelligence). */
export function isReleaseDetailPending(release) {
  if (!release?.backendReleaseId) return false;
  if (release.detailLoaded === true) return false;
  return true;
}

/** Merge list API stubs with already-hydrated rows so re-sync does not wipe detail. */
export function mergeListStubsWithExisting(prev, stubs) {
  const prevByBackend = new Map(prev.map((r) => [r.backendReleaseId, r]));
  return stubs.map((stub) => {
    const existing = prevByBackend.get(stub.backendReleaseId);
    if (existing?.detailLoaded || existing?.summaryLoaded) {
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
        collection_deadline: stub.collection_deadline ?? existing.collection_deadline,
        summaryLoaded: existing.summaryLoaded || stub.summaryLoaded,
        detailLoaded: existing.detailLoaded || stub.detailLoaded
      };
    }
    return stub;
  });
}

/** Max summary hydrations enqueued on initial list sync (rest via visible-row callback). */
export const RELEASE_TABLE_INITIAL_HYDRATE = 20;

/** All release ids that still need summary hydration. */
export function allPendingReleaseIds(releases) {
  return releases.filter(isSummaryPending).map((r) => r.backendReleaseId);
}

/** Pending summary ids limited to a subset of backend release ids (e.g. visible table rows). */
export function pendingSummaryIdsForReleases(releases, backendIds) {
  const idSet = new Set((backendIds || []).filter(Boolean));
  if (!idSet.size) return [];
  return releases
    .filter((r) => idSet.has(r.backendReleaseId) && isSummaryPending(r))
    .map((r) => r.backendReleaseId);
}

/** First N pending summary ids for initial table hydration after list sync. */
export function initialReleaseTablePendingIds(releases, { limit = RELEASE_TABLE_INITIAL_HYDRATE } = {}) {
  return allPendingReleaseIds(releases).slice(0, limit);
}

/** Chart-window release ids that still need summary hydration (for trends priority enqueue). */
export function chartWindowPendingIds(releases, windowSize) {
  return [...releases]
    .slice(-windowSize)
    .filter(isSummaryPending)
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
    const existing = releases[ix];
    const next = [...releases];
    if (existing.detailLoaded && !mapped.detailLoaded) {
      next[ix] = {
        ...existing,
        ...mapped,
        id: releases[ix].id,
        detailLoaded: true,
        summaryLoaded: true,
        intelligence: existing.intelligence ?? mapped.intelligence,
        overrideBy: existing.overrideBy ?? mapped.overrideBy,
        overrideReason: existing.overrideReason ?? mapped.overrideReason,
        release_deltas: existing.release_deltas ?? mapped.release_deltas
      };
    } else {
      next[ix] = { ...existing, ...mapped, id: releases[ix].id };
    }
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
