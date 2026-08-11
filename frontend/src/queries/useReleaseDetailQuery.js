import { useQuery } from "@tanstack/react-query";
import { getWorkspaceId } from "../lib/apiClient.js";
import { fetchAndMapReleaseDetail } from "../lib/releaseDetailApi.js";
import { hasBackend } from "../lib/hasBackend.js";
import { workspaceKeys } from "./workspaceKeys.js";

const RELEASE_DETAIL_STALE_MS = 30_000;

export function releaseDetailQueryOptions(wsId, releaseId, navigate, { enabled = true } = {}) {
  return {
    queryKey: workspaceKeys.releaseDetail(wsId, releaseId),
    queryFn: () => fetchAndMapReleaseDetail(releaseId, navigate),
    enabled: Boolean(enabled && wsId && releaseId),
    staleTime: RELEASE_DETAIL_STALE_MS
  };
}

export function mergeReleaseDetailForDisplay(releaseStub, detail) {
  if (!detail) return releaseStub;
  if (!releaseStub) return detail;
  const stubUpdatedMs = Date.parse(releaseStub.updated_at || "");
  const detailUpdatedMs = Date.parse(detail.updated_at || "");
  const stubIsNewer =
    Number.isFinite(stubUpdatedMs) &&
    (!Number.isFinite(detailUpdatedMs) || stubUpdatedMs > detailUpdatedMs);
  const summary = stubIsNewer ? releaseStub : detail;
  return {
    ...releaseStub,
    ...detail,
    id: releaseStub.id,
    backendReleaseId: releaseStub.backendReleaseId || detail.backendReleaseId,
    version: summary.version,
    status: summary.status,
    date: summary.date,
    releaseType: summary.releaseType,
    environment: summary.environment,
    evidenceQuality: summary.evidenceQuality,
    created_at: summary.created_at,
    updated_at: summary.updated_at,
    verdict_issued_at: summary.verdict_issued_at,
    collection_deadline: summary.collection_deadline,
    signals: summary.signals,
    signalRows: summary.signalRows,
    detailLoaded: true,
    summaryLoaded: true
  };
}

export function useReleaseDetailQuery(releaseId, navigate, { enabled = true } = {}) {
  const wsId = getWorkspaceId();
  return useQuery(
    releaseDetailQueryOptions(wsId, releaseId, navigate, {
      enabled: enabled && hasBackend()
    })
  );
}

export { RELEASE_DETAIL_STALE_MS };
