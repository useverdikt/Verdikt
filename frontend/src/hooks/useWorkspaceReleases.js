import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, getWorkspaceId } from "../lib/apiClient.js";
import {
  mergeReleaseIntoList,
  refreshReleaseDetail,
  RELEASE_UPDATED_EVENT,
  awaitReleaseDetail,
  enqueueReleaseHydration,
  mergeListStubsWithExisting,
  isReleaseDetailPending,
  isSummaryPending,
  initialReleaseTablePendingIds,
  pendingSummaryIdsForReleases,
  chartWindowPendingIds,
  resetHydrationPool,
  syncHydratedFromReleases,
  setHydrationNavigate,
  setOnEach
} from "../lib/releaseDetailRefresh.js";
import { hasBackend } from "../lib/hasBackend.js";
import { S } from "../lib/workspaceStorage.js";
import { TREND_CHART_MAX_POINTS } from "../lib/trendChart.js";
import { mapBackendListRowToUi } from "../lib/releaseMappers.js";

/** Release list, hydration pool, pagination, and detail fetch helpers. */
export function useWorkspaceReleases(navigate, nav, { setApiBanner } = {}) {
  const [releases, setReleases] = useState(() => {
    if (hasBackend()) return [];
    const s = S.get("releases", null);
    return Array.isArray(s) ? s : [];
  });
  const [selectedId, setSelectedId] = useState(() => {
    if (hasBackend()) return null;
    const s = S.get("releases", null);
    const list = Array.isArray(s) ? s : [];
    return list[0]?.id ?? null;
  });
  const [_releasesTotalCount, setReleasesTotalCount] = useState(null);
  const [releasesNextBefore, setReleasesNextBefore] = useState(null);
  const [releasesLoadingMore, setReleasesLoadingMore] = useState(false);

  const releasesRef = useRef(releases);
  releasesRef.current = releases;
  const navRef = useRef(nav);
  navRef.current = nav;
  const workspaceIdRef = useRef(getWorkspaceId());

  const scheduleReleaseHydration = useCallback((mergedReleases, { priorityChartWindow = false } = {}) => {
    syncHydratedFromReleases(mergedReleases, isSummaryPending);
    if (priorityChartWindow) {
      const chartIds = chartWindowPendingIds(mergedReleases, TREND_CHART_MAX_POINTS);
      if (chartIds.length) enqueueReleaseHydration(chartIds, { priority: true });
      return;
    }
    const pending = initialReleaseTablePendingIds(mergedReleases);
    if (pending.length) enqueueReleaseHydration(pending, { priority: false });
  }, []);

  const hydrateVisibleSummaries = useCallback((visibleReleases) => {
    if (!hasBackend() || !visibleReleases?.length) return;
    const ids = pendingSummaryIdsForReleases(
      releasesRef.current,
      visibleReleases.map((r) => r.backendReleaseId)
    );
    if (ids.length) enqueueReleaseHydration(ids, { priority: false });
  }, []);

  useEffect(() => {
    if (!hasBackend()) return;
    setHydrationNavigate(navigate);
    setOnEach((mapped) => setReleases((prev) => mergeReleaseIntoList(prev, mapped)));
    return () => {
      setOnEach(null);
      resetHydrationPool();
    };
  }, [navigate]);

  useEffect(() => {
    if (!hasBackend() || nav !== "release") return;
    syncHydratedFromReleases(releasesRef.current, isSummaryPending);
    const pending = initialReleaseTablePendingIds(releasesRef.current);
    if (pending.length) enqueueReleaseHydration(pending, { priority: false });
  }, [nav]);

  useEffect(() => {
    if (!hasBackend()) return;
    const wsId = getWorkspaceId();
    if (workspaceIdRef.current !== wsId) {
      resetHydrationPool();
      workspaceIdRef.current = wsId;
    }
  }, []);

  useEffect(() => {
    if (hasBackend()) return;
    S.set("releases", releases);
  }, [releases]);

  useEffect(() => {
    if (!hasBackend() || nav !== "trend") return;
    syncHydratedFromReleases(releasesRef.current, isSummaryPending);
    const chartIds = chartWindowPendingIds(releasesRef.current, TREND_CHART_MAX_POINTS);
    if (chartIds.length) enqueueReleaseHydration(chartIds, { priority: true });
  }, [nav]);

  useEffect(() => {
    const onReleaseUpdated = (event) => {
      const mapped = event?.detail;
      if (!mapped?.backendReleaseId) return;
      setReleases((prev) => mergeReleaseIntoList(prev, mapped));
    };
    window.addEventListener(RELEASE_UPDATED_EVENT, onReleaseUpdated);
    return () => window.removeEventListener(RELEASE_UPDATED_EVENT, onReleaseUpdated);
  }, []);

  const applyReleaseListFromServer = useCallback(
    (relData, { priorityChartWindow = false } = {}) => {
      const rows = relData?.releases || [];
      setReleasesNextBefore(relData?.next_before || null);
      if (rows.length) {
        setReleasesTotalCount(typeof relData?.total_count === "number" ? relData.total_count : rows.length);
        const stubs = rows.map(mapBackendListRowToUi);
        let merged = stubs;
        setReleases((prev) => {
          merged = mergeListStubsWithExisting(prev, stubs);
          return merged;
        });
        setSelectedId((sel) => (merged.some((r) => r.id === sel) ? sel : merged[0]?.id ?? null));
        scheduleReleaseHydration(merged, { priorityChartWindow });
        return merged;
      }
      setReleasesTotalCount(typeof relData?.total_count === "number" ? relData.total_count : 0);
      setReleases([]);
      setSelectedId(null);
      return [];
    },
    [scheduleReleaseHydration]
  );

  const ensureReleaseDetail = useCallback(
    async (backendReleaseId) => {
      if (!hasBackend() || !backendReleaseId) return null;
      const existing = releasesRef.current.find((r) => r.backendReleaseId === backendReleaseId);
      if (existing && !isReleaseDetailPending(existing)) return existing;
      try {
        setApiBanner?.(null);
        setHydrationNavigate(navigate);
        const mapped = await awaitReleaseDetail(backendReleaseId, { priority: true, full: true });
        if (mapped) setReleases((prev) => mergeReleaseIntoList(prev, mapped));
        return mapped;
      } catch (e) {
        setApiBanner?.(e.message || "Failed to load release details");
        return null;
      }
    },
    [navigate, setApiBanner]
  );

  const refreshReleaseFromBackend = useCallback(
    async (backendReleaseId) => {
      if (!hasBackend() || !backendReleaseId) return;
      try {
        setApiBanner?.(null);
        const mapped = await refreshReleaseDetail(backendReleaseId, navigate, { emit: false, force: true });
        if (mapped) setReleases((prev) => mergeReleaseIntoList(prev, mapped));
      } catch (e) {
        setApiBanner?.(e.message || "Failed to refresh release from server");
      }
    },
    [navigate, setApiBanner]
  );

  const loadMoreReleases = useCallback(async () => {
    if (!hasBackend() || !releasesNextBefore || releasesLoadingMore) return;
    setReleasesLoadingMore(true);
    try {
      setApiBanner?.(null);
      const data = await apiGet(
        `/api/workspaces/${getWorkspaceId()}/releases?limit=50&before=${encodeURIComponent(releasesNextBefore)}`,
        { navigate }
      );
      const rows = data?.releases || [];
      setReleasesNextBefore(data?.next_before || null);
      const stubs = rows.map(mapBackendListRowToUi);
      if (stubs.length) {
        let appended = [];
        setReleases((prev) => {
          const seen = new Set(prev.map((r) => r.backendReleaseId));
          appended = stubs.filter((s) => !seen.has(s.backendReleaseId));
          return [...prev, ...appended];
        });
        if (appended.length) {
          syncHydratedFromReleases(releasesRef.current, isSummaryPending);
          const pending = initialReleaseTablePendingIds(appended);
          if (pending.length) enqueueReleaseHydration(pending, { priority: false });
        }
      }
    } catch (e) {
      setApiBanner?.(e.message || "Failed to load more releases");
    } finally {
      setReleasesLoadingMore(false);
    }
  }, [navigate, releasesNextBefore, releasesLoadingMore, scheduleReleaseHydration, setApiBanner]);

  const openAuditRecord = useCallback(
    async (linkedRelease, backendReleaseId, { showToast, toastColor }) => {
      if (linkedRelease) return linkedRelease;
      if (!backendReleaseId || !hasBackend()) return null;
      try {
        setApiBanner?.(null);
        setHydrationNavigate(navigate);
        const mapped = await awaitReleaseDetail(backendReleaseId, { priority: true, full: true });
        if (!mapped) return null;
        setReleases((prev) => mergeReleaseIntoList(prev, mapped));
        return mapped;
      } catch (e) {
        setApiBanner?.(e.message || "Could not load release record from audit entry");
        if (showToast && toastColor) {
          showToast("Could not load certification record for this audit entry", toastColor);
        }
        return null;
      }
    },
    [navigate, setApiBanner]
  );

  return {
    releases,
    setReleases,
    selectedId,
    setSelectedId,
    releasesNextBefore,
    releasesLoadingMore,
    scheduleReleaseHydration,
    applyReleaseListFromServer,
    ensureReleaseDetail,
    refreshReleaseFromBackend,
    loadMoreReleases,
    openAuditRecord,
    hydrateVisibleSummaries,
    navRef
  };
}
