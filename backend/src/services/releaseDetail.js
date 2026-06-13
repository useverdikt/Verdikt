"use strict";

const { queryOne, queryAll } = require("../database");
const { getOutcomeAlignmentForRelease } = require("./productionFeedback");
const { getLatestIntegrationPullForRelease } = require("./integrationPullStatus");

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

module.exports = { buildReleaseSummary, loadLastSignalEvaluation };
