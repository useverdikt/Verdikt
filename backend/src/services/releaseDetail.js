"use strict";

const { queryOne, queryAll } = require("../database");
const { getOutcomeAlignmentForRelease } = require("./productionFeedback");
const { getLatestIntegrationPullForRelease } = require("./integrationPullStatus");
const { getReleaseIntelligence } = require("./intelligenceBuilder");
const { listReleaseDeltas } = require("./delta");
const {
  resolveEvidenceForRelease,
  persistReleaseEvidenceQuality
} = require("./evidenceQuality");
const { buildGateContext } = require("./gateContext");
const { isProdEnvironment, isCertLikeStatus } = require("./releaseEnvironment");
const { computeAndPersistRecommendation } = require("./recommendationEngine");

const CERT_LIKE_STATUSES = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE", "UNCERTIFIED"]);

async function loadLastSignalEvaluation(releaseId) {
  const lastEvalRow = await queryOne(
    `SELECT details_json FROM audit_events
       WHERE release_id = ? AND event_type = 'SIGNALS_INGESTED'
       ORDER BY id DESC LIMIT 1`,
    [releaseId]
  );
  if (!lastEvalRow) return null;
  try {
    const d = JSON.parse(lastEvalRow.details_json || "{}");
    return {
      threshold_failed_signals: Array.isArray(d.threshold_failed_signals) ? d.threshold_failed_signals : undefined,
      missing_signals: Array.isArray(d.missing_signals) ? d.missing_signals : undefined,
      failed_signals: Array.isArray(d.failed_signals) ? d.failed_signals : undefined,
      computed_status: d.computed_status
    };
  } catch {
    return null;
  }
}

function mapOverrideRow(override) {
  if (!override) return null;
  return {
    ...override,
    metadata: JSON.parse(override.metadata_json || "{}"),
    updated_at: override.updated_at || override.created_at
  };
}

function mapOverrideHistoryRows(rows) {
  return (rows || []).map((row) => ({
    ...row,
    metadata: JSON.parse(row.metadata_json || "{}")
  }));
}

async function maybePersistEvidenceQuality(release, releaseId, signalRows) {
  let evidence_quality = release.evidence_quality ?? null;
  let evidence_summary = null;
  ({ evidence_quality, evidence_summary } = resolveEvidenceForRelease(release, signalRows));

  let releaseOut = release;
  if (
    !release.evidence_quality &&
    CERT_LIKE_STATUSES.has(String(release.status || "").toUpperCase()) &&
    signalRows.length > 0
  ) {
    try {
      const persisted = await persistReleaseEvidenceQuality(releaseId);
      evidence_quality = persisted.evidence_quality;
      evidence_summary = persisted.evidence_summary;
      releaseOut = {
        ...release,
        evidence_quality,
        evidence_summary_json: JSON.stringify(evidence_summary)
      };
    } catch (_) {}
  }

  return { release: releaseOut, evidence_quality, evidence_summary };
}

/** Lightweight payload for list/trend hydration — no audit, intelligence, or overrides. */
async function buildReleaseSummary(release) {
  const releaseId = release.id;
  const [signalRows, last_signal_evaluation, outcome_alignment, integration_pull, connectedIntegrations] =
    await Promise.all([
      queryAll(
        "SELECT id, signal_id, value, source, created_at FROM signals WHERE release_id = ? ORDER BY id DESC",
        [releaseId]
      ),
      loadLastSignalEvaluation(releaseId),
      getOutcomeAlignmentForRelease(releaseId),
      getLatestIntegrationPullForRelease(releaseId),
      queryAll("SELECT source_id FROM signal_integrations WHERE workspace_id = ?", [release.workspace_id])
    ]);

  return {
    release: {
      ...release,
      ai_context: JSON.parse(release.ai_context_json || "{}"),
      evidence_quality: release.evidence_quality ?? null,
      evidence_summary: release.evidence_summary_json ? JSON.parse(release.evidence_summary_json) : null
    },
    signals: signalRows,
    connected_integrations: connectedIntegrations.map((r) => r.source_id),
    integration_pull,
    last_signal_evaluation,
    outcome_alignment
  };
}

/** Expand/detail payload — overrides, intelligence, deltas; no audit trail. */
async function buildReleaseDetail(release) {
  const releaseId = release.id;

  const [
    signalRows,
    override,
    overrideHistoryRows,
    last_signal_evaluation,
    intelligence,
    deltas,
    outcome_alignment,
    integration_pull,
    connectedIntegrations
  ] = await Promise.all([
    queryAll(
      "SELECT id, signal_id, value, source, created_at FROM signals WHERE release_id = ? ORDER BY id DESC",
      [releaseId]
    ),
    queryOne("SELECT * FROM overrides WHERE release_id = ?", [releaseId]),
    queryAll(
      "SELECT id, release_id, approver_type, approver_name, approver_role, justification, metadata_json, created_at FROM override_history WHERE release_id = ? ORDER BY id ASC",
      [releaseId]
    ),
    loadLastSignalEvaluation(releaseId),
    getReleaseIntelligence(releaseId),
    listReleaseDeltas(releaseId),
    getOutcomeAlignmentForRelease(releaseId),
    getLatestIntegrationPullForRelease(releaseId),
    queryAll("SELECT source_id FROM signal_integrations WHERE workspace_id = ?", [release.workspace_id])
  ]);

  const { release: releaseOut, evidence_quality, evidence_summary } = await maybePersistEvidenceQuality(
    release,
    releaseId,
    signalRows
  );

  let intelligenceOut = intelligence;
  if (isProdEnvironment(releaseOut.environment) && !isCertLikeStatus(releaseOut.status)) {
    try {
      const recommendation = await computeAndPersistRecommendation(releaseOut);
      intelligenceOut = { ...(intelligence || {}), recommendation };
    } catch (err) {
      console.error("[recommendation_engine] prod detail refresh failed:", releaseId, err?.message);
    }
  }

  const { certification } = await buildGateContext(release, intelligenceOut);

  return {
    release: {
      ...releaseOut,
      ai_context: JSON.parse(releaseOut.ai_context_json || "{}"),
      evidence_quality,
      evidence_summary
    },
    signals: signalRows,
    deltas,
    connected_integrations: connectedIntegrations.map((r) => r.source_id),
    integration_pull,
    override: mapOverrideRow(override),
    override_history: mapOverrideHistoryRows(overrideHistoryRows),
    last_signal_evaluation,
    intelligence: intelligenceOut,
    certification,
    outcome_alignment
  };
}

module.exports = { buildReleaseSummary, buildReleaseDetail, loadLastSignalEvaluation };
