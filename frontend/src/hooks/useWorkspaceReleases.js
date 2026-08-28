import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWorkspaceId } from "../lib/apiClient.js";
import {
  mergeReleaseIntoList,
  mergeListStubsWithExisting,
  isReleaseDetailPending,
  initialReleaseTablePendingIds,
  projectReleaseForList
} from "../lib/releaseDetailRefresh.js";
import { hasBackend } from "../lib/hasBackend.js";
import { S } from "../lib/workspaceStorage.js";
import { mapBackendListRowToUi } from "../lib/releaseMappers.js";
import { appQueryClient } from "../queries/queryClient.js";
import { workspaceKeys } from "../queries/workspaceKeys.js";
import { fetchWorkspaceReleases } from "../queries/workspaceFetchers.js";
import { releaseDetailQueryOptions } from "../queries/useReleaseDetailQuery.js";
import {
  uniqueReleaseIds,
  useOverlaidReleaseSummaries
} from "../queries/useReleaseSummaryQueries.js";

const RELEASE_PAGE_SIZE = 50;

function sameIdList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/** Release list, visible-row summary queries, pagination, and detail fetch helpers. */
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
  const [shippedWithoutCertificationCount, setShippedWithoutCertificationCount] = useState(null);
  const [productionIncidentsCount, setProductionIncidentsCount] = useState(null);
  const [falseCertificationRatePct, setFalseCertificationRatePct] = useState(null);
  const [remediationDebtActive, setRemediationDebtActive] = useState(false);
  const [releasesNextBefore, setReleasesNextBefore] = useState(null);
  const [releasesLoadingMore, setReleasesLoadingMore] = useState(false);
  const [summaryIds, setSummaryIds] = useState([]);

  const releasesRef = useRef(releases);
  const workspaceIdRef = useRef(getWorkspaceId());

  useEffect(() => {
    releasesRef.current = releases;
  }, [releases]);

  const hydrateVisibleSummaries = useCallback((visibleReleases) => {
    if (!hasBackend()) return;
    const ids = uniqueReleaseIds((visibleReleases || []).map((r) => r.backendReleaseId));
    setSummaryIds((prev) => (sameIdList(prev, ids) ? prev : ids));
  }, []);

  useEffect(() => {
    if (!hasBackend()) return;
    const wsId = getWorkspaceId();
    if (workspaceIdRef.current !== wsId) {
      workspaceIdRef.current = wsId;
      setSummaryIds([]);
    }
  }, []);

  useEffect(() => {
    if (hasBackend()) return;
    S.set("releases", releases);
  }, [releases]);

  const applyReleaseListFromServer = useCallback((relData) => {
    const rows = relData?.releases || [];
    setReleasesNextBefore(relData?.next_before || null);
    if (typeof relData?.shipped_without_certification_count === "number") {
      setShippedWithoutCertificationCount(relData.shipped_without_certification_count);
    }
    if (typeof relData?.production_incidents_count === "number") {
      setProductionIncidentsCount(relData.production_incidents_count);
    }
    if (
      typeof relData?.false_certification_rate_pct === "number" ||
      relData?.false_certification_rate_pct === null
    ) {
      setFalseCertificationRatePct(relData.false_certification_rate_pct);
    }
    if (typeof relData?.remediation_debt_active === "boolean") {
      setRemediationDebtActive(relData.remediation_debt_active);
    }
    if (rows.length) {
      setReleasesTotalCount(typeof relData?.total_count === "number" ? relData.total_count : rows.length);
      const stubs = rows.map(mapBackendListRowToUi);
      let merged = stubs;
      setReleases((prev) => {
        merged = mergeListStubsWithExisting(prev.map(projectReleaseForList), stubs);
        return merged;
      });
      setSelectedId((sel) => (merged.some((r) => r.id === sel) ? sel : merged[0]?.id ?? null));
      setSummaryIds(initialReleaseTablePendingIds(merged));
      return merged;
    }
    setReleasesTotalCount(typeof relData?.total_count === "number" ? relData.total_count : 0);
    setReleases([]);
    setSelectedId(null);
    setSummaryIds([]);
    return [];
  }, []);

  const refreshReleaseFromBackend = useCallback(
    async (backendReleaseId) => {
      if (!hasBackend() || !backendReleaseId) return;
      try {
        setApiBanner?.(null);
        const wsId = getWorkspaceId();
        const mapped = await appQueryClient.fetchQuery(
          releaseDetailQueryOptions(wsId, backendReleaseId, navigate)
        );
        if (mapped) {
          setReleases((prev) => mergeReleaseIntoList(prev, projectReleaseForList(mapped)));
        }
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
      const wsId = getWorkspaceId();
      const data = await appQueryClient.fetchQuery({
        queryKey: workspaceKeys.releases(wsId, { limit: RELEASE_PAGE_SIZE, before: releasesNextBefore }),
        queryFn: () =>
          fetchWorkspaceReleases(wsId, navigate, { limit: RELEASE_PAGE_SIZE, before: releasesNextBefore })
      });
      const rows = data?.releases || [];
      setReleasesNextBefore(data?.next_before || null);
      const stubs = rows.map(mapBackendListRowToUi);
      if (stubs.length) {
        setReleases((prev) => {
          const seen = new Set(prev.map((r) => r.backendReleaseId));
          const appended = stubs.filter((s) => !seen.has(s.backendReleaseId));
          return appended.length ? [...prev, ...appended] : prev;
        });
      }
    } catch (e) {
      setApiBanner?.(e.message || "Failed to load more releases");
    } finally {
      setReleasesLoadingMore(false);
    }
  }, [navigate, releasesNextBefore, releasesLoadingMore, setApiBanner]);

  const openAuditRecord = useCallback(
    async (linkedRelease, backendReleaseId, { showToast, toastColor }) => {
      if (linkedRelease && (!hasBackend() || !isReleaseDetailPending(linkedRelease))) {
        return linkedRelease;
      }
      const releaseId = backendReleaseId || linkedRelease?.backendReleaseId;
      if (!releaseId || !hasBackend()) return linkedRelease || null;
      try {
        setApiBanner?.(null);
        return await appQueryClient.fetchQuery(
          releaseDetailQueryOptions(getWorkspaceId(), releaseId, navigate)
        );
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

  const summaryQueryIds = useMemo(() => {
    if (nav === "release") return summaryIds;
    return [];
  }, [nav, summaryIds]);

  const overlaidReleases = useOverlaidReleaseSummaries(releases, summaryQueryIds, navigate);

  return {
    releases: overlaidReleases,
    setReleases,
    selectedId,
    setSelectedId,
    releasesNextBefore,
    releasesLoadingMore,
    applyReleaseListFromServer,
    refreshReleaseFromBackend,
    loadMoreReleases,
    openAuditRecord,
    hydrateVisibleSummaries,
    shippedWithoutCertificationCount,
    productionIncidentsCount,
    falseCertificationRatePct,
    remediationDebtActive
  };
}
