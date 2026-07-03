import { useMutation } from "@tanstack/react-query";
import { apiPost, getWorkspaceId } from "../lib/apiClient.js";
import { thresholdNormalizedToApiPayload } from "../lib/thresholdBounds.js";
import {
  invalidateReleaseDomain,
  invalidateThresholdDomain,
  invalidateFullWorkspace
} from "./workspaceMutations.js";

/**
 * TanStack Query mutations with targeted cache invalidation for workspace writes.
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

  const postReleaseSignals = useMutation({
    mutationFn: ({ releaseId, body }) => apiPost(`/api/releases/${releaseId}/signals`, body, { navigate }),
    onSuccess: async () => {
      await invalidateReleaseDomain(wsId);
    }
  });

  const overrideRelease = useMutation({
    mutationFn: ({ releaseId, body }) => apiPost(`/api/releases/${releaseId}/override`, body, { navigate }),
    onSuccess: async () => {
      await invalidateReleaseDomain(wsId);
    }
  });

  const pullReleaseSources = useMutation({
    mutationFn: (releaseId) => apiPost(`/api/releases/${releaseId}/sources/pull`, {}, { navigate }),
    onSuccess: async () => {
      await invalidateReleaseDomain(wsId);
    }
  });

  const adoptSignalDefinition = useMutation({
    mutationFn: (signalId) =>
      apiPost(`/api/workspaces/${wsId}/signal-definitions/adopt`, { signal_id: signalId }, { navigate }),
    onSuccess: async () => {
      await invalidateThresholdDomain(wsId);
    }
  });

  return {
    wsId,
    saveThresholds,
    applyThresholdSuggestion,
    dismissThresholdSuggestion,
    postReleaseSignals,
    overrideRelease,
    pullReleaseSources,
    adoptSignalDefinition
  };
}
