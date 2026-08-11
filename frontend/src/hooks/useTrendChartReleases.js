import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { TREND_CHART_MAX_POINTS } from "../lib/trendChart.js";
import { mapBackendListRowToUi } from "../lib/releaseMappers.js";
import { DEFAULT_THRESHOLDS } from "../lib/workspaceDefaults.js";
import { S } from "../lib/workspaceStorage.js";
import { readInitialThresholdUiState } from "../lib/thresholdLocalState.js";
import { applyThresholdApiMap } from "../lib/thresholdBounds.js";
import {
  chartWindowPendingIds,
  enqueueReleaseHydration,
  mergeReleaseIntoList,
  RELEASE_UPDATED_EVENT,
  resetHydrationPool,
  setHydrationNavigate,
  setOnEach,
  syncHydratedFromReleases,
  isSummaryPending,
  projectReleaseForList
} from "../lib/releaseDetailRefresh.js";
import { appQueryClient } from "../queries/queryClient.js";
import { workspaceKeys } from "../queries/workspaceKeys.js";
import { fetchWorkspaceReleases, fetchWorkspaceThresholds } from "../queries/workspaceFetchers.js";

const RELEASE_LIST_LIMIT = 50;

/** Release list + chart-window hydration for Intelligence Hub → Signal trends. */
export function useTrendChartReleases() {
  const navigate = useNavigate();
  const [releases, setReleases] = useState(() => {
    if (hasBackend()) return [];
    const s = S.get("releases", null);
    return Array.isArray(s) ? s : [];
  });
  const [wsReady, setWsReady] = useState(!hasBackend());
  const [thresholds, setThresholds] = useState(() => readInitialThresholdUiState().thresholds);
  const releasesRef = useRef(releases);

  useEffect(() => {
    releasesRef.current = releases;
  }, [releases]);

  const scheduleChartHydration = useCallback((mergedReleases) => {
    syncHydratedFromReleases(mergedReleases, isSummaryPending);
    const chartIds = chartWindowPendingIds(mergedReleases, TREND_CHART_MAX_POINTS);
    if (chartIds.length) enqueueReleaseHydration(chartIds, { priority: true });
  }, []);

  useEffect(() => {
    if (!hasBackend()) return;
    setHydrationNavigate(navigate);
    setOnEach((mapped) =>
      setReleases((prev) => mergeReleaseIntoList(prev, projectReleaseForList(mapped)))
    );
    return () => {
      setOnEach(null);
      resetHydrationPool();
    };
  }, [navigate]);

  useEffect(() => {
    const onReleaseUpdated = (event) => {
      const mapped = event?.detail;
      if (!mapped?.backendReleaseId) return;
      setReleases((prev) => mergeReleaseIntoList(prev, projectReleaseForList(mapped)));
    };
    window.addEventListener(RELEASE_UPDATED_EVENT, onReleaseUpdated);
    return () => window.removeEventListener(RELEASE_UPDATED_EVENT, onReleaseUpdated);
  }, []);

  useEffect(() => {
    if (!hasBackend()) {
      setWsReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const wsId = getWorkspaceId();
        const [relData, thData] = await Promise.all([
          appQueryClient.fetchQuery({
            queryKey: workspaceKeys.releases(wsId, { limit: RELEASE_LIST_LIMIT }),
            queryFn: () => fetchWorkspaceReleases(wsId, navigate, { limit: RELEASE_LIST_LIMIT })
          }),
          appQueryClient
            .fetchQuery({
              queryKey: workspaceKeys.thresholds(wsId),
              queryFn: () => fetchWorkspaceThresholds(wsId, navigate)
            })
            .catch(() => null)
        ]);
        if (cancelled) return;
        const rows = Array.isArray(relData?.releases) ? relData.releases : [];
        const mapped = rows.map(mapBackendListRowToUi);
        setReleases(mapped);
        scheduleChartHydration(mapped);
        if (thData?.thresholds) {
          const parsed = applyThresholdApiMap(thData.thresholds);
          setThresholds({ ...DEFAULT_THRESHOLDS, ...parsed.thresholds });
        }
        setWsReady(true);
      } catch {
        if (!cancelled) setWsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, scheduleChartHydration]);

  return { releases, wsReady, thresholds };
}
