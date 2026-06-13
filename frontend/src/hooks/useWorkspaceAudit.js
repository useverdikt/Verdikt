import { useCallback, useEffect, useState } from "react";
import { apiGet, getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { S, DEFAULT_AUDIT, mapWorkspaceAuditEventsToLog } from "../app/main/appMainLogic.js";

const AUDIT_PAGE_SIZE = 50;

/** Workspace audit log state and refresh helpers. */
export function useWorkspaceAudit(navigate, { setApiBanner } = {}) {
  const [auditLog, setAuditLog] = useState(() => (hasBackend() ? [] : S.get("audit", DEFAULT_AUDIT)));
  const [auditNextBefore, setAuditNextBefore] = useState(null);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);

  useEffect(() => {
    if (hasBackend()) return;
    S.set("audit", auditLog);
  }, [auditLog]);

  const applyAuditFromApi = useCallback(
    (auditData, { append = false } = {}) => {
      if (auditData?._error) {
        setApiBanner?.((prev) => prev || auditData._error.message || "Failed to load audit log");
        return false;
      }
      const events = mapWorkspaceAuditEventsToLog(auditData?.events || []);
      setAuditLog((prev) => (append ? [...prev, ...events] : events));
      setAuditNextBefore(auditData?.next_before ?? null);
      return true;
    },
    [setApiBanner]
  );

  const refreshAuditFromServer = useCallback(async () => {
    if (!hasBackend()) return;
    try {
      setApiBanner?.(null);
      const data = await apiGet(`/api/workspaces/${getWorkspaceId()}/audit?limit=${AUDIT_PAGE_SIZE}`, { navigate });
      applyAuditFromApi(data);
    } catch (e) {
      setApiBanner?.(e.message || "Failed to refresh audit log");
    }
  }, [navigate, setApiBanner, applyAuditFromApi]);

  const loadMoreAudit = useCallback(async () => {
    if (!hasBackend() || !auditNextBefore || auditLoadingMore) return;
    setAuditLoadingMore(true);
    try {
      setApiBanner?.(null);
      const data = await apiGet(
        `/api/workspaces/${getWorkspaceId()}/audit?limit=${AUDIT_PAGE_SIZE}&before=${encodeURIComponent(auditNextBefore)}`,
        { navigate }
      );
      applyAuditFromApi(data, { append: true });
    } catch (e) {
      setApiBanner?.(e.message || "Failed to load more audit events");
    } finally {
      setAuditLoadingMore(false);
    }
  }, [navigate, setApiBanner, applyAuditFromApi, auditNextBefore, auditLoadingMore]);

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
    applyAuditFromApi,
    auditNextBefore,
    auditLoadingMore,
    loadMoreAudit,
    auditPageSize: AUDIT_PAGE_SIZE
  };
}
