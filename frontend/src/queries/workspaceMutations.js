import { appQueryClient } from "./queryClient.js";
import {
  invalidateWorkspaceAudit,
  invalidateWorkspaceQueries,
  invalidateWorkspaceReleases,
  invalidateWorkspaceRelease,
  invalidateWorkspaceSignalDefinitions,
  invalidateWorkspaceThresholds
} from "./invalidateWorkspace.js";

/** After threshold or signal-definition changes. */
export async function invalidateThresholdDomain(wsId) {
  if (!wsId) return;
  await Promise.all([
    invalidateWorkspaceThresholds(wsId),
    invalidateWorkspaceSignalDefinitions(wsId)
  ]);
}

/** After release-scoped mutations (override, ingest, pull, etc.). */
export async function invalidateReleaseDomain(wsId, releaseId) {
  if (!wsId) return;
  if (releaseId) {
    await Promise.all([
      invalidateWorkspaceReleases(wsId),
      invalidateWorkspaceRelease(wsId, releaseId),
      invalidateWorkspaceAudit(wsId)
    ]);
    return;
  }
  await Promise.all([invalidateWorkspaceReleases(wsId), invalidateWorkspaceAudit(wsId)]);
}

/** Full workspace refresh — settings saves, ship, broad policy changes. */
export async function invalidateFullWorkspace(wsId) {
  if (!wsId) return invalidateWorkspaceQueries(wsId);
  return invalidateWorkspaceQueries(wsId);
}

/** Imperative post-mutation cache refresh (usable outside React hooks). */
export async function afterWorkspaceMutation(wsId, scope = "full") {
  if (scope === "thresholds") return invalidateThresholdDomain(wsId);
  if (scope === "release") return invalidateReleaseDomain(wsId);
  return invalidateFullWorkspace(wsId);
}

/** @deprecated prefer scoped helpers — kept for compatibility */
export { invalidateWorkspaceQueries, appQueryClient };
