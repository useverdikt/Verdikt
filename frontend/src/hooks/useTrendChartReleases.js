import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { TREND_CHART_MAX_POINTS } from "../lib/trendChart.js";
import { mapBackendListRowToUi } from "../lib/releaseMappers.js";
import { DEFAULT_THRESHOLDS } from "../lib/workspaceDefaults.js";
import { S } from "../lib/workspaceStorage.js";
import { readInitialThresholdUiState } from "../lib/thresholdLocalState.js";
import { applyThresholdApiMap } from "../lib/thresholdBounds.js";
import { chartWindowReleaseIds } from "../lib/releaseDetailRefresh.js";
import { appQueryClient } from "../queries/queryClient.js";
import { workspaceKeys } from "../queries/workspaceKeys.js";
import { fetchWorkspaceReleases, fetchWorkspaceThresholds } from "../queries/workspaceFetchers.js";
import { useOverlaidReleaseSummaries } from "../queries/useReleaseSummaryQueries.js";

const RELEASE_LIST_LIMIT = 50;

/** Release list + chart-window summary queries for Intelligence Hub → Signal trends. */
export function useTrendChartReleases() {
  const navigate = useNavigate();
  const [releases, setReleases] = useState(() => {
    if (hasBackend()) return [];
    const s = S.get("releases", null);
    return Array.isArray(s) ? s : [];
  });
  const [wsReady, setWsReady] = useState(!hasBackend());
  const [thresholds, setThresholds] = useState(() => readInitialThresholdUiState().thresholds);

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
        setReleases(rows.map(mapBackendListRowToUi));
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
  }, [navigate]);

  const chartIds = useMemo(
    () => chartWindowReleaseIds(releases, TREND_CHART_MAX_POINTS),
    [releases]
  );
  const overlaidReleases = useOverlaidReleaseSummaries(releases, chartIds, navigate);

  return { releases: overlaidReleases, wsReady, thresholds };
}
