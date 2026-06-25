import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { useWorkspaceReleases } from "../hooks/useWorkspaceReleases.js";
import { useWorkspaceThresholds } from "../hooks/useWorkspaceThresholds.js";
import { useWorkspaceAudit } from "../hooks/useWorkspaceAudit.js";
import { useWorkspaceAuth } from "../hooks/useWorkspaceAuth.js";
import { appQueryClient } from "../queries/queryClient.js";
import { workspaceKeys } from "../queries/workspaceKeys.js";
import {
  fetchSignalDefinitions,
  fetchWorkspaceAudit,
  fetchWorkspaceReleases,
  fetchWorkspaceThresholds
} from "../queries/workspaceFetchers.js";
import {
  WorkspaceAuditContext,
  WorkspaceAuthContext,
  WorkspaceReleasesContext,
  WorkspaceShellContext,
  WorkspaceThresholdsContext
} from "./workspaceContext.js";

/**
 * Workspace-scoped state split into domain contexts + TanStack Query cache for API reads.
 */
export function WorkspaceProvider({ navigate, nav, children }) {
  const [wsReady, setWsReady] = useState(!hasBackend());
  const [apiBanner, setApiBanner] = useState(null);
  const [workspaceSyncing, setWorkspaceSyncing] = useState(false);

  const authApi = useWorkspaceAuth(navigate);
  const releasesApi = useWorkspaceReleases(navigate, nav, { setApiBanner });
  const thresholdsApi = useWorkspaceThresholds(navigate, nav);
  const auditApi = useWorkspaceAudit(navigate, { setApiBanner });

  const { applyReleaseListFromServer, navRef: releasesNavRef } = releasesApi;
  const { applyThresholdsFromApi, applySignalCatalogFromApi } = thresholdsApi;
  const { applyAuditFromApi } = auditApi;

  const refreshWorkspaceFromServer = useCallback(
    async (opts = {}) => {
      const { cancelledRef, manual } = opts;
      if (!hasBackend()) return;
      const isCancelled = () => cancelledRef && cancelledRef.cancelled;
      if (manual) setWorkspaceSyncing(true);
      const wsId = getWorkspaceId();
      try {
        if (!isCancelled()) setApiBanner(null);
        const [thData, relData, auditData, sigCatalog] = await Promise.all([
          appQueryClient.fetchQuery({
            queryKey: workspaceKeys.thresholds(wsId),
            queryFn: () => fetchWorkspaceThresholds(wsId, navigate)
          }),
          appQueryClient.fetchQuery({
            queryKey: workspaceKeys.releases(wsId, { limit: 50 }),
            queryFn: () => fetchWorkspaceReleases(wsId, navigate, { limit: 50 })
          }),
          appQueryClient
            .fetchQuery({
              queryKey: workspaceKeys.audit(wsId, { limit: 50 }),
              queryFn: () => fetchWorkspaceAudit(wsId, navigate, { limit: 50 })
            })
            .catch((e) => ({ _error: e })),
          appQueryClient
            .fetchQuery({
              queryKey: workspaceKeys.signalDefinitions(wsId),
              queryFn: () => fetchSignalDefinitions(wsId, navigate)
            })
            .catch(() => null)
        ]);
        if (isCancelled()) return;
        applyThresholdsFromApi(thData);
        if (sigCatalog && !sigCatalog._error) {
          applySignalCatalogFromApi(sigCatalog);
        }
        applyReleaseListFromServer(relData, {
          priorityChartWindow: releasesNavRef.current === "trend"
        });
        applyAuditFromApi(auditData);
      } catch (e) {
        if (!isCancelled()) setApiBanner(e.message || "Failed to sync workspace from server");
      } finally {
        if (manual) setWorkspaceSyncing(false);
        if (!isCancelled()) setWsReady(true);
      }
    },
    [
      navigate,
      applyReleaseListFromServer,
      applyThresholdsFromApi,
      applyAuditFromApi,
      releasesNavRef,
      applySignalCatalogFromApi
    ]
  );

  useEffect(() => {
    if (!hasBackend()) return;
    const cancelledRef = { cancelled: false };
    void refreshWorkspaceFromServer({ cancelledRef });
    return () => {
      cancelledRef.cancelled = true;
    };
  }, [navigate, refreshWorkspaceFromServer]);

  const shellValue = useMemo(
    () => ({
      wsReady,
      apiBanner,
      setApiBanner,
      workspaceSyncing,
      refreshWorkspaceFromServer
    }),
    [wsReady, apiBanner, workspaceSyncing, refreshWorkspaceFromServer]
  );

  return (
    <WorkspaceShellContext.Provider value={shellValue}>
      <WorkspaceAuthContext.Provider value={authApi}>
        <WorkspaceReleasesContext.Provider value={releasesApi}>
          <WorkspaceThresholdsContext.Provider value={thresholdsApi}>
            <WorkspaceAuditContext.Provider value={auditApi}>{children}</WorkspaceAuditContext.Provider>
          </WorkspaceThresholdsContext.Provider>
        </WorkspaceReleasesContext.Provider>
      </WorkspaceAuthContext.Provider>
    </WorkspaceShellContext.Provider>
  );
}
