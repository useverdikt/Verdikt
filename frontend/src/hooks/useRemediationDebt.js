import { useQuery } from "@tanstack/react-query";
import { apiGet, getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";
import { workspaceKeys } from "../queries/workspaceKeys.js";

/**
 * Workspace remediation debt after emergency merge without certification.
 */
export function useRemediationDebt(navigate) {
  const wsId = getWorkspaceId();
  const enabled = hasBackend() && Boolean(wsId);
  const query = useQuery({
    queryKey: workspaceKeys.remediationDebt(wsId || "local"),
    queryFn: () => apiGet(`/api/workspaces/${wsId}/remediation-debt`, { navigate }),
    enabled
  });

  return {
    debt: enabled ? query.data || (query.isError ? { active: false } : null) : { active: false },
    refresh: query.refetch
  };
}
