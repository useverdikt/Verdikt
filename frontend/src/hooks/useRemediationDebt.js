import { useCallback, useEffect, useState } from "react";
import { apiGet, getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";

/**
 * Workspace remediation debt after emergency merge without certification.
 */
export function useRemediationDebt(navigate) {
  const [debt, setDebt] = useState(null);

  const refresh = useCallback(async () => {
    const wsId = getWorkspaceId();
    if (!hasBackend() || !wsId) {
      setDebt({ active: false });
      return null;
    }
    try {
      const data = await apiGet(`/api/workspaces/${wsId}/remediation-debt`, { navigate });
      setDebt(data);
      return data;
    } catch {
      setDebt({ active: false });
      return { active: false };
    }
  }, [navigate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { debt, refresh };
}
