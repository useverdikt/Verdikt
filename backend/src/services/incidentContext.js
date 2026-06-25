"use strict";

const { queryOne } = require("../database");
const { getWorkspaceRemediationDebt } = require("./remediationDebt");

const INCIDENT_LOOKBACK_DAYS = 7;

/**
 * Corroborate that a workspace is in an active incident response window.
 * Required before agents/humans can open incident_hotfix releases via API.
 */
async function getWorkspaceIncidentCorroboration(workspaceId) {
  const sources = [];

  const debt = await getWorkspaceRemediationDebt(workspaceId);
  if (debt.active) {
    sources.push({
      type: "remediation_debt",
      detail: debt.source_version || debt.source_release_id || null
    });
  }

  const vcsRow = await queryOne(
    `
    SELECT release_id, inferred_outcome
    FROM vcs_monitoring_windows
    WHERE workspace_id = $1
      AND UPPER(COALESCE(inferred_outcome, '')) IN ('INCIDENT', 'INVESTIGATING')
      AND monitoring_end >= NOW() - INTERVAL '${INCIDENT_LOOKBACK_DAYS} days'
    ORDER BY monitoring_end DESC
    LIMIT 1
  `,
    [workspaceId]
  );
  if (vcsRow) {
    sources.push({
      type: "vcs_monitor",
      outcome: vcsRow.inferred_outcome,
      release_id: vcsRow.release_id
    });
  }

  const alignmentRow = await queryOne(
    `
    SELECT release_id, actual_outcome
    FROM outcome_alignments
    WHERE workspace_id = $1
      AND UPPER(COALESCE(actual_outcome, '')) = 'INCIDENT'
      AND computed_at >= NOW() - INTERVAL '${INCIDENT_LOOKBACK_DAYS} days'
    ORDER BY computed_at DESC
    LIMIT 1
  `,
    [workspaceId]
  );
  if (alignmentRow) {
    sources.push({
      type: "production_incident",
      release_id: alignmentRow.release_id
    });
  }

  return {
    eligible: sources.length > 0,
    lookback_days: INCIDENT_LOOKBACK_DAYS,
    sources,
    message:
      sources.length > 0
        ? "Active incident context corroborated."
        : "No active incident context — remediation debt, VCS INVESTIGATING/INCIDENT, or confirmed prod INCIDENT required for incident_hotfix."
  };
}

module.exports = { getWorkspaceIncidentCorroboration, INCIDENT_LOOKBACK_DAYS };
