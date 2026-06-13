import { useCallback, useEffect, useState } from "react";
import { apiGet, getWorkspaceId } from "../lib/apiClient.js";
import { persistAuthSession } from "../auth/persistSession.js";
import { hasBackend } from "../lib/hasBackend.js";
import { applyThresholdApiMap, defaultRequiredFlags } from "../lib/thresholdBounds.js";
import {
  S,
  DEFAULT_THRESHOLDS,
  DEFAULT_AUDIT,
  mapWorkspaceAuditEventsToLog
} from "../app/main/appMainLogic.js";
import { useWorkspaceReleases } from "./useWorkspaceReleases.js";

export function useWorkspaceSync(navigate, nav) {
  const [wsReady, setWsReady] = useState(!hasBackend());
  const [thresholds, setThresholds] = useState(() => ({
    ...DEFAULT_THRESHOLDS,
    ...S.get("thresholds", {})
  }));
  const [thresholdRequired, setThresholdRequired] = useState(() =>
    S.get("thresholdRequired", defaultRequiredFlags())
  );
  const [auditLog, setAuditLog] = useState(() => (hasBackend() ? [] : S.get("audit", DEFAULT_AUDIT)));
  const [currentUser, setCurrentUser] = useState(() => {
    if (hasBackend()) return null;
    const u = S.get("currentUser", null);
    if (u && u.role === "viewer") return { ...u, role: "engineer" };
    return u;
  });
  const [apiBanner, setApiBanner] = useState(null);
  const [workspaceSyncing, setWorkspaceSyncing] = useState(false);
  const [thresholdSuggestions, setThresholdSuggestions] = useState([]);
  const [thresholdSuggestNote, setThresholdSuggestNote] = useState("");

  const releasesApi = useWorkspaceReleases(navigate, nav, { setApiBanner });

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
          apiGet(`/api/workspaces/${getWorkspaceId()}/audit`, { navigate }).catch((e) => ({ _error: e }))
        ]);
        if (isCancelled()) return;
        const map = thData?.thresholds || {};
        const parsed = applyThresholdApiMap(map);
        setThresholds((prev) => ({ ...DEFAULT_THRESHOLDS, ...prev, ...parsed.thresholds }));
        setThresholdRequired((prev) => ({ ...defaultRequiredFlags(), ...prev, ...parsed.required }));
        releasesApi.applyReleaseListFromServer(relData, {
          priorityChartWindow: releasesApi.navRef.current === "trend"
        });
        if (auditData?._error) {
          setApiBanner((prev) => prev || auditData._error.message || "Failed to load audit log");
        } else {
          setAuditLog(mapWorkspaceAuditEventsToLog(auditData?.events || []));
        }
      } catch (e) {
        if (!isCancelled()) setApiBanner(e.message || "Failed to sync workspace from server");
      } finally {
        if (manual) setWorkspaceSyncing(false);
        if (!isCancelled()) setWsReady(true);
      }
    },
    [navigate, releasesApi]
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
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet("/api/auth/me", { navigate });
        if (cancelled || !data?.user) return;
        persistAuthSession({ user: data.user });
        setCurrentUser({
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role
        });
      } catch {
        /* ProtectedRoute handles unauthenticated redirects */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (!hasBackend()) return;
    const cancelledRef = { cancelled: false };
    void refreshWorkspaceFromServer({ cancelledRef });
    return () => {
      cancelledRef.cancelled = true;
    };
  }, [navigate, refreshWorkspaceFromServer]);

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

  return {
    wsReady,
    releases: releasesApi.releases,
    setReleases: releasesApi.setReleases,
    selectedId: releasesApi.selectedId,
    setSelectedId: releasesApi.setSelectedId,
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
    ensureReleaseDetail: releasesApi.ensureReleaseDetail,
    refreshReleaseFromBackend: releasesApi.refreshReleaseFromBackend,
    loadMoreReleases: releasesApi.loadMoreReleases,
    releasesNextBefore: releasesApi.releasesNextBefore,
    releasesLoadingMore: releasesApi.releasesLoadingMore,
    addAudit,
    openAuditRecord: releasesApi.openAuditRecord
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
