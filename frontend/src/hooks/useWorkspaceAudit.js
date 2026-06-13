import { useCallback, useEffect, useState } from "react";
import { apiGet, getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { S, DEFAULT_AUDIT, mapWorkspaceAuditEventsToLog } from "../app/main/appMainLogic.js";

/** Workspace audit log state and refresh helpers. */
export function useWorkspaceAudit(navigate, { setApiBanner } = {}) {
  const [auditLog, setAuditLog] = useState(() => (hasBackend() ? [] : S.get("audit", DEFAULT_AUDIT)));

  useEffect(() => {
    if (hasBackend()) return;
    S.set("audit", auditLog);
  }, [auditLog]);

  const applyAuditFromApi = useCallback((auditData) => {
    if (auditData?._error) {
      setApiBanner?.((prev) => prev || auditData._error.message || "Failed to load audit log");
      return false;
    }
    setAuditLog(mapWorkspaceAuditEventsToLog(auditData?.events || []));
    return true;
  }, [setApiBanner]);

  const refreshAuditFromServer = useCallback(async () => {
    if (!hasBackend()) return;
    try {
      setApiBanner?.(null);
      const data = await apiGet(`/api/workspaces/${getWorkspaceId()}/audit`, { navigate });
      applyAuditFromApi(data);
    } catch (e) {
      setApiBanner?.(e.message || "Failed to refresh audit log");
    }
  }, [navigate, setApiBanner, applyAuditFromApi]);

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
    auditLog,
    setAuditLog,
    addAudit,
    refreshAuditFromServer,
    applyAuditFromApi
  };
}
