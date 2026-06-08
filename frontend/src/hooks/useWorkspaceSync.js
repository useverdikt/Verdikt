import { useCallback, useEffect, useState } from "react";
import { apiGet, getWorkspaceId } from "../lib/apiClient.js";
import {
  mergeReleaseIntoList,
  refreshReleaseDetail,
  RELEASE_UPDATED_EVENT
} from "../lib/releaseDetailRefresh.js";
import { hasBackend } from "../lib/hasBackend.js";
import { applyThresholdApiMap, defaultRequiredFlags } from "../lib/thresholdBounds.js";
import {
  S,
  DEFAULT_THRESHOLDS,
  DEFAULT_AUDIT,
  mapWorkspaceAuditEventsToLog,
  mapBackendDetailToUi
} from "../app/main/appMainLogic.js";

export function useWorkspaceSync(navigate, nav) {
  const [wsReady, setWsReady] = useState(!hasBackend());
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
  const [thresholds, setThresholds] = useState(() => ({
    ...DEFAULT_THRESHOLDS,
    ...S.get("thresholds", {})
  }));
  const [thresholdRequired, setThresholdRequired] = useState(() =>
    S.get("thresholdRequired", defaultRequiredFlags())
  );
  const [auditLog, setAuditLog] = useState(() => (hasBackend() ? [] : S.get("audit", DEFAULT_AUDIT)));
  const [currentUser, setCurrentUser] = useState(() => {
    const u = S.get("currentUser", null);
    if (u && u.role === "viewer") return { ...u, role: "engineer" };
    return u;
  });
  const [apiBanner, setApiBanner] = useState(null);
  const [workspaceSyncing, setWorkspaceSyncing] = useState(false);
  const [thresholdSuggestions, setThresholdSuggestions] = useState([]);
  const [thresholdSuggestNote, setThresholdSuggestNote] = useState("");
  const [_releasesTotalCount, setReleasesTotalCount] = useState(null);
  const [releasesNextBefore, setReleasesNextBefore] = useState(null);
  const [releasesLoadingMore, setReleasesLoadingMore] = useState(false);

  useEffect(() => {
    if (hasBackend()) return;
    S.set("releases", releases);
  }, [releases]);

  useEffect(() => {
    if (hasBackend()) return;
    S.set("thresholds", thresholds);
  }, [thresholds]);

  useEffect(() => {
    S.set("thresholdRequired", thresholdRequired);
  }, [thresholdRequired]);

  useEffect(() => {
    if (hasBackend()) return;
    S.set("audit", auditLog);
  }, [auditLog]);

  useEffect(() => {
    if (currentUser) S.set("currentUser", currentUser);
  }, [currentUser]);

  const refreshWorkspaceFromServer = useCallback(
    async (opts = {}) => {
      const { cancelledRef, manual } = opts;
      if (!hasBackend()) return;
      const isCancelled = () => cancelledRef && cancelledRef.cancelled;
      if (manual) setWorkspaceSyncing(true);
      try {
        if (!isCancelled()) setApiBanner(null);
        const [thData, relData, auditData] = await Promise.all([
          apiGet(`/api/workspaces/${getWorkspaceId()}/thresholds`, { navigate }),
          apiGet(`/api/workspaces/${getWorkspaceId()}/releases?limit=50`, { navigate }),
          apiGet(`/api/workspaces/${getWorkspaceId()}/audit`, { navigate })
        ]);
        if (isCancelled()) return;
        const map = thData?.thresholds || {};
        const parsed = applyThresholdApiMap(map);
        setThresholds((prev) => ({ ...DEFAULT_THRESHOLDS, ...prev, ...parsed.thresholds }));
        setThresholdRequired((prev) => ({ ...defaultRequiredFlags(), ...prev, ...parsed.required }));
        const rows = relData?.releases || [];
        setReleasesNextBefore(relData?.next_before || null);
        setAuditLog(mapWorkspaceAuditEventsToLog(auditData?.events || []));
        if (rows.length) {
          setReleasesTotalCount(typeof relData?.total_count === "number" ? relData.total_count : rows.length);
          void (async () => {
            const details = await Promise.all(
              rows.map((r) => apiGet(`/api/releases/${r.id}`, { navigate }).catch(() => null))
            );
            if (isCancelled()) return;
            const mapped = details.map((d) => (d ? mapBackendDetailToUi(d) : null)).filter(Boolean);
            if (!mapped.length) return;
            setReleases(mapped);
            setSelectedId((sel) => (mapped.some((r) => r.id === sel) ? sel : mapped[0]?.id ?? null));
          })();
        } else {
          setReleasesTotalCount(typeof relData?.total_count === "number" ? relData.total_count : 0);
          setReleases([]);
          setSelectedId(null);
        }
      } catch (e) {
        if (!isCancelled()) setApiBanner(e.message || "Failed to sync workspace from server");
      } finally {
        if (manual) setWorkspaceSyncing(false);
        if (!isCancelled()) setWsReady(true);
      }
    },
    [navigate]
  );

  const refreshAuditFromServer = useCallback(async () => {
    if (!hasBackend()) return;
    try {
      setApiBanner(null);
      const data = await apiGet(`/api/workspaces/${getWorkspaceId()}/audit`, { navigate });
      setAuditLog(mapWorkspaceAuditEventsToLog(data?.events || []));
    } catch (e) {
      setApiBanner(e.message || "Failed to refresh audit log");
    }
  }, [navigate]);

  const loadThresholdSuggestions = useCallback(async () => {
    if (!hasBackend()) {
      setThresholdSuggestions([]);
      setThresholdSuggestNote("");
      return;
    }
    setThresholdSuggestNote("Loading suggestions…");
    try {
      const data = await apiGet(`/api/workspaces/${getWorkspaceId()}/threshold-suggestions`, { navigate });
      setThresholdSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      setThresholdSuggestNote("");
    } catch (e) {
      const msg = e?.message || "";
      if (msg.includes("404") || msg.toLowerCase().includes("disabled")) {
        setThresholdSuggestions([]);
        setThresholdSuggestNote("Suggestions are currently disabled for this workspace.");
        return;
      }
      setThresholdSuggestions([]);
      setThresholdSuggestNote("Suggestions unavailable");
    }
  }, [navigate]);

  useEffect(() => {
    if (nav === "thresholds") void loadThresholdSuggestions();
  }, [nav, loadThresholdSuggestions]);

  useEffect(() => {
    if (!hasBackend()) return;
    const cancelledRef = { cancelled: false };
    void refreshWorkspaceFromServer({ cancelledRef });
    return () => {
      cancelledRef.cancelled = true;
    };
  }, [navigate, refreshWorkspaceFromServer]);

  useEffect(() => {
    const onReleaseUpdated = (event) => {
      const mapped = event?.detail;
      if (!mapped?.backendReleaseId) return;
      setReleases((prev) => mergeReleaseIntoList(prev, mapped));
    };
    window.addEventListener(RELEASE_UPDATED_EVENT, onReleaseUpdated);
    return () => window.removeEventListener(RELEASE_UPDATED_EVENT, onReleaseUpdated);
  }, []);

  const refreshReleaseFromBackend = useCallback(
    async (backendReleaseId) => {
      if (!hasBackend() || !backendReleaseId) return;
      try {
        setApiBanner(null);
        const mapped = await refreshReleaseDetail(backendReleaseId, navigate, { emit: false });
        setReleases((prev) => mergeReleaseIntoList(prev, mapped));
      } catch (e) {
        setApiBanner(e.message || "Failed to refresh release from server");
      }
    },
    [navigate]
  );

  const loadMoreReleases = useCallback(async () => {
    if (!hasBackend() || !releasesNextBefore || releasesLoadingMore) return;
    setReleasesLoadingMore(true);
    try {
      setApiBanner(null);
      const data = await apiGet(
        `/api/workspaces/${getWorkspaceId()}/releases?limit=50&before=${encodeURIComponent(releasesNextBefore)}`,
        { navigate }
      );
      const rows = data?.releases || [];
      setReleasesNextBefore(data?.next_before || null);
      const details = await Promise.all(
        rows.map((r) => apiGet(`/api/releases/${r.id}`, { navigate }).catch(() => null))
      );
      const mapped = details.map((d) => (d ? mapBackendDetailToUi(d) : null)).filter(Boolean);
      if (mapped.length) {
        setReleases((prev) => [...prev, ...mapped]);
      }
    } catch (e) {
      setApiBanner(e.message || "Failed to load more releases");
    } finally {
      setReleasesLoadingMore(false);
    }
  }, [navigate, releasesNextBefore, releasesLoadingMore]);

  const addAudit = useCallback(
    (e) =>
      setAuditLog((p) => [
        {
          id: Date.now(),
          ...e
        },
        ...p
      ]),
    []
  );

  const openAuditRecord = useCallback(
    async (linkedRelease, backendReleaseId, { showToast, toastColor }) => {
      if (linkedRelease) {
        return linkedRelease;
      }
      if (!backendReleaseId || !hasBackend()) return null;
      try {
        setApiBanner(null);
        const detail = await apiGet(`/api/releases/${backendReleaseId}`, { navigate });
        const mapped = mapBackendDetailToUi(detail);
        setReleases((prev) => {
          const ix = prev.findIndex((r) => r.backendReleaseId === backendReleaseId);
          if (ix >= 0) {
            const next = [...prev];
            next[ix] = { ...next[ix], ...mapped };
            return next;
          }
          return [mapped, ...prev];
        });
        return mapped;
      } catch (e) {
        setApiBanner(e.message || "Could not load release record from audit entry");
        if (showToast && toastColor) {
          showToast("Could not load certification record for this audit entry", toastColor);
        }
        return null;
      }
    },
    [navigate]
  );

  return {
    wsReady,
    releases,
    setReleases,
    selectedId,
    setSelectedId,
    thresholds,
    setThresholds,
    thresholdRequired,
    setThresholdRequired,
    auditLog,
    setAuditLog,
    currentUser,
    setCurrentUser,
    apiBanner,
    setApiBanner,
    workspaceSyncing,
    thresholdSuggestions,
    thresholdSuggestNote,
    refreshWorkspaceFromServer,
    refreshAuditFromServer,
    loadThresholdSuggestions,
    refreshReleaseFromBackend,
    loadMoreReleases,
    addAudit
  };
}

export function useAuditRecordOpener({ openAuditRecord, setAuditDetail, showToast, toastColor }) {
  return useCallback(
    async (linkedRelease, backendReleaseId) => {
      if (linkedRelease) {
        setAuditDetail(linkedRelease);
        return;
      }
      const mapped = await openAuditRecord(linkedRelease, backendReleaseId, { showToast, toastColor });
      if (mapped) setAuditDetail(mapped);
    },
    [openAuditRecord, setAuditDetail, showToast, toastColor]
  );
}
