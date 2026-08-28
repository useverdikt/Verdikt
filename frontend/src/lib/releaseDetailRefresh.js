import { getWorkspaceId } from "./apiClient.js";
import { trendChartWindowReleases } from "./trendChart.js";
import { appQueryClient } from "../queries/queryClient.js";
import { releaseDetailQueryOptions } from "../queries/useReleaseDetailQuery.js";
import { workspaceKeys } from "../queries/workspaceKeys.js";

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

/** Merge list API stubs with hydrated summaries so re-sync does not wipe signals. */
export function mergeListStubsWithExisting(prev, stubs) {
  const prevByBackend = new Map(prev.map((r) => [r.backendReleaseId, r]));
  return stubs.map((stub) => {
    const existing = prevByBackend.get(stub.backendReleaseId);
    if (existing?.summaryLoaded) {
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
        summaryLoaded: true,
        detailLoaded: false
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

/** Chart-window release ids that still need summary hydration. */
export function chartWindowPendingIds(releases, windowSize) {
  return trendChartWindowReleases(releases, windowSize)
    .filter(isSummaryPending)
    .map((r) => r.backendReleaseId)
    .filter(Boolean);
}

/** All backend ids in the trend chart window (fetched via useQueries). */
export function chartWindowReleaseIds(releases, windowSize) {
  return trendChartWindowReleases(releases, windowSize)
    .map((r) => r.backendReleaseId)
    .filter(Boolean);
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
    next[ix] = { ...existing, ...mapped, id: releases[ix].id };
    return next;
  }
  return [mapped, ...releases];
}

/** Keep only list/summary state locally; full detail remains query-owned. */
export function projectReleaseForList(mapped) {
  if (!mapped) return mapped;
  return {
    ...mapped,
    intelligence: undefined,
    certification: undefined,
    release_deltas: undefined,
    overrideBy: undefined,
    overrideReason: undefined,
    detailLoaded: false,
    summaryLoaded: mapped.summaryLoaded === true || mapped.detailLoaded === true
  };
}

function lookupSummary(summaryById, id) {
  if (!id || !summaryById) return undefined;
  if (typeof summaryById.get === "function") return summaryById.get(id);
  return summaryById[id];
}

/** Overlay query-owned signals onto a list stub. Status/version stay on the list row. */
export function overlayReleaseSummary(release, summary, { failed = false } = {}) {
  if (!release) return release;
  if (failed && !summary) {
    return { ...release, summaryLoaded: true };
  }
  if (!summary) return release;
  const projected = projectReleaseForList(summary);
  return {
    ...release,
    signals: projected.signals ?? release.signals,
    signalRows: projected.signalRows ?? release.signalRows,
    alignmentVerdict: projected.alignmentVerdict ?? release.alignmentVerdict,
    outcomeAlignment: projected.outcomeAlignment ?? release.outcomeAlignment,
    last_signal_evaluation: projected.last_signal_evaluation ?? release.last_signal_evaluation,
    evidence_summary: projected.evidence_summary ?? release.evidence_summary,
    summaryLoaded: true,
    detailLoaded: false
  };
}

export function overlayReleaseSummaries(releases, summaryById, failedIds = []) {
  if (!Array.isArray(releases)) return releases;
  const failed = failedIds instanceof Set ? failedIds : new Set(failedIds);
  return releases.map((release) =>
    overlayReleaseSummary(release, lookupSummary(summaryById, release.backendReleaseId), {
      failed: failed.has(release.backendReleaseId)
    })
  );
}

/** Fetch full detail through TanStack Query. */
export async function refreshReleaseDetail(backendReleaseId, navigate, { force = true } = {}) {
  const wsId = getWorkspaceId();
  if (!backendReleaseId || !wsId) return null;
  if (force) {
    await appQueryClient.invalidateQueries({ queryKey: workspaceKeys.releaseRoot(wsId, backendReleaseId) });
  }
  return appQueryClient.fetchQuery(releaseDetailQueryOptions(wsId, backendReleaseId, navigate));
}
