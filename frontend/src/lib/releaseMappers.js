import { mapBackendStatusToUi } from "./releaseStatus.js";
import { mapBackendAlignmentToUi } from "./releaseAlignmentMeta.js";
import { buildReleaseSourceLanes } from "./releaseSourceLanes.js";
import { latestSignalRowMap } from "./signalProvenance.js";

export function mapBackendDetailToUi(detail) {
  const release = detail.release;
  const bid = release.id;
  const signalRows = (detail.signals || []).map((s) => ({
    id: s.id,
    signal_id: s.signal_id,
    value: s.value,
    source: s.source ?? null,
    created_at: s.created_at ?? null
  }));
  const rowMap = latestSignalRowMap(signalRows);
  const signals = Object.fromEntries(Object.entries(rowMap).map(([k, v]) => [k, v.value]));
  const sourceLanes =
    release.status === "COLLECTING"
      ? buildReleaseSourceLanes({
          connectedIntegrationIds: detail.connected_integrations || [],
          signalRows: detail.signals || [],
          integrationPull: detail.integration_pull || null,
          releaseStatus: release.status
        })
      : [];
  const out = {
    id: `rc-${bid.replace(/\W/g, "")}`,
    backendReleaseId: bid,
    version: release.version,
    date: (release.created_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
    releaseType: release.release_type || "model_update",
    environment: release.environment || "",
    status: mapBackendStatusToUi(release.status),
    signals,
    signalRows: Object.values(rowMap),
    evidenceQuality: release.evidence_quality ?? null,
    evidence_summary: release.evidence_summary ?? null,
    sources: sourceLanes
  };
  if (release.environment) out.buildRef = release.environment;
  if (detail.override) {
    out.overrideBy = detail.override.approver_name;
    out.overrideReason = detail.override.justification;
  }
  if (detail.intelligence) out.intelligence = detail.intelligence;
  if (detail.certification) out.certification = detail.certification;
  if (detail.outcome_alignment?.alignment) {
    out.alignmentVerdict = mapBackendAlignmentToUi(detail.outcome_alignment.alignment);
    out.outcomeAlignment = detail.outcome_alignment;
  } else {
    out.alignmentVerdict = "uncertified";
  }
  if (release.created_at) out.created_at = release.created_at;
  if (release.updated_at) out.updated_at = release.updated_at;
  if (release.collection_deadline) out.collection_deadline = release.collection_deadline;
  if (release.verdict_issued_at) out.verdict_issued_at = release.verdict_issued_at;
  if (release.shipped_without_certification != null) {
    out.shipped_without_certification = Number(release.shipped_without_certification) === 1;
  }
  if (release.shipped_without_certification_at) {
    out.shipped_without_certification_at = release.shipped_without_certification_at;
  }
  if (detail.last_signal_evaluation && typeof detail.last_signal_evaluation === "object") {
    out.last_signal_evaluation = detail.last_signal_evaluation;
  }
  if (Array.isArray(detail.deltas) && detail.deltas.length) out.release_deltas = detail.deltas;
  if (detail.integration_pull) out.integration_pull = detail.integration_pull;
  out.detailLoaded = true;
  out.summaryLoaded = true;
  return out;
}

export function mapBackendSummaryToUi(detail) {
  const mapped = mapBackendDetailToUi(detail);
  mapped.detailLoaded = false;
  mapped.summaryLoaded = true;
  return mapped;
}

export function mapBackendListRowToUi(row) {
  const bid = row.id;
  return {
    id: `rc-${bid.replace(/\W/g, "")}`,
    backendReleaseId: bid,
    version: row.version,
    date: (row.created_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
    releaseType: row.release_type || "model_update",
    environment: row.environment || "",
    status: mapBackendStatusToUi(row.status),
    signals: {},
    signalRows: [],
    evidenceQuality: row.evidence_quality ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    verdict_issued_at: row.verdict_issued_at,
    collection_deadline: row.collection_deadline,
    shipped_without_certification: Number(row.shipped_without_certification) === 1,
    shipped_without_certification_at: row.shipped_without_certification_at ?? null,
    detailLoaded: false
  };
}
