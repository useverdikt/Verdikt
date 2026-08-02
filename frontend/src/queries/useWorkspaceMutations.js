import { useMutation } from "@tanstack/react-query";
import { apiPost, getWorkspaceId } from "../lib/apiClient.js";
import { thresholdNormalizedToApiPayload } from "../lib/thresholdBounds.js";
import {
  invalidateThresholdDomain,
  invalidateFullWorkspace
} from "./workspaceMutations.js";

/**
 * TanStack Query mutations with targeted cache invalidation for workspace writes.
 * Release mutations live in useReleaseActions (invalidate + force refresh into local state).
 */
export function useWorkspaceMutations(navigate) {
  const wsId = getWorkspaceId();

  const saveThresholds = useMutation({
    mutationFn: async ({ local, localRequired }) => {
      const payload = thresholdNormalizedToApiPayload(local, localRequired);
      return apiPost(`/api/workspaces/${wsId}/thresholds`, { thresholds: payload }, { navigate });
    },
    onSuccess: async () => {
      await invalidateThresholdDomain(wsId);
    }
  });

  const applyThresholdSuggestion = useMutation({
    mutationFn: (id) =>
      apiPost(
        `/api/workspaces/${wsId}/threshold-suggestions/${encodeURIComponent(id)}/apply`,
        {},
        { navigate }
      ),
    onSuccess: async () => {
      await invalidateFullWorkspace(wsId);
    }
  });

  const dismissThresholdSuggestion = useMutation({
    mutationFn: (id) =>
      apiPost(
        `/api/workspaces/${wsId}/threshold-suggestions/${encodeURIComponent(id)}/dismiss`,
        { reason: "user_dismissed" },
        { navigate }
      ),
    onSuccess: async () => {
      await invalidateThresholdDomain(wsId);
    }
  });

  return {
    wsId,
    saveThresholds,
    applyThresholdSuggestion,
    dismissThresholdSuggestion
  };
}
