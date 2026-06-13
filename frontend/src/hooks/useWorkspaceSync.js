import { useCallback, useEffect, useState } from "react";
import { apiGet, getWorkspaceId } from "../lib/apiClient.js";
import { persistAuthSession } from "../auth/persistSession.js";
import { hasBackend } from "../lib/hasBackend.js";
import { S } from "../app/main/appMainLogic.js";
import { useWorkspaceReleases } from "./useWorkspaceReleases.js";
import { useWorkspaceThresholds } from "./useWorkspaceThresholds.js";
import { useWorkspaceAudit } from "./useWorkspaceAudit.js";

export function useWorkspaceSync(navigate, nav) {
  const [wsReady, setWsReady] = useState(!hasBackend());
  const [currentUser, setCurrentUser] = useState(() => {
    if (hasBackend()) return null;
    const u = S.get("currentUser", null);
    if (u && u.role === "viewer") return { ...u, role: "engineer" };
    return u;
  });
  const [apiBanner, setApiBanner] = useState(null);
  const [workspaceSyncing, setWorkspaceSyncing] = useState(false);

  const releasesApi = useWorkspaceReleases(navigate, nav, { setApiBanner });
  const thresholdsApi = useWorkspaceThresholds(navigate, nav);
  const auditApi = useWorkspaceAudit(navigate, { setApiBanner });

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
        thresholdsApi.applyThresholdsFromApi(thData);
        releasesApi.applyReleaseListFromServer(relData, {
          priorityChartWindow: releasesApi.navRef.current === "trend"
        });
        auditApi.applyAuditFromApi(auditData);
      } catch (e) {
        if (!isCancelled()) setApiBanner(e.message || "Failed to sync workspace from server");
      } finally {
        if (manual) setWorkspaceSyncing(false);
        if (!isCancelled()) setWsReady(true);
      }
    },
    [navigate, releasesApi, thresholdsApi, auditApi]
  );

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

  return {
    wsReady,
    releases: releasesApi.releases,
    setReleases: releasesApi.setReleases,
    selectedId: releasesApi.selectedId,
    setSelectedId: releasesApi.setSelectedId,
    thresholds: thresholdsApi.thresholds,
    setThresholds: thresholdsApi.setThresholds,
    thresholdRequired: thresholdsApi.thresholdRequired,
    setThresholdRequired: thresholdsApi.setThresholdRequired,
    auditLog: auditApi.auditLog,
    setAuditLog: auditApi.setAuditLog,
    currentUser,
    setCurrentUser,
    apiBanner,
    setApiBanner,
    workspaceSyncing,
    thresholdSuggestions: thresholdsApi.thresholdSuggestions,
    thresholdSuggestNote: thresholdsApi.thresholdSuggestNote,
    refreshWorkspaceFromServer,
    refreshAuditFromServer: auditApi.refreshAuditFromServer,
    loadThresholdSuggestions: thresholdsApi.loadThresholdSuggestions,
    ensureReleaseDetail: releasesApi.ensureReleaseDetail,
    hydrateVisibleSummaries: releasesApi.hydrateVisibleSummaries,
    refreshReleaseFromBackend: releasesApi.refreshReleaseFromBackend,
    loadMoreReleases: releasesApi.loadMoreReleases,
    releasesNextBefore: releasesApi.releasesNextBefore,
    releasesLoadingMore: releasesApi.releasesLoadingMore,
    addAudit: auditApi.addAudit,
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
