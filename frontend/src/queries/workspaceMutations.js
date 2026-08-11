import { appQueryClient } from "./queryClient.js";
import {
  invalidateWorkspaceAudit,
  invalidateWorkspaceQueries,
  invalidateWorkspaceReleases,
  invalidateWorkspaceRelease,
  invalidateWorkspaceRemediationDebt,
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
      invalidateWorkspaceAudit(wsId),
      invalidateWorkspaceRemediationDebt(wsId)
    ]);
    return;
  }
  await Promise.all([
    invalidateWorkspaceReleases(wsId),
    invalidateWorkspaceAudit(wsId),
    invalidateWorkspaceRemediationDebt(wsId)
  ]);
}

/** Full workspace refresh — settings saves, ship, broad policy changes. */
export async function invalidateFullWorkspace(wsId) {
  if (!wsId) return invalidateWorkspaceQueries(wsId);
  return invalidateWorkspaceQueries(wsId);
}

/** @deprecated prefer scoped helpers — kept for compatibility */
export { invalidateWorkspaceQueries, appQueryClient };
