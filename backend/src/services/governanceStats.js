"use strict";

const { queryOne } = require("../database");
const { getWorkspaceRemediationDebt } = require("./remediationDebt");
const { computeFalseCertificationRatePct } = require("./productionFeedback");

/**
 * Confirmed production breaks: INCIDENT outcome from alignment or VCS monitor.
 */
async function countProductionIncidents(workspaceId) {
  const row = await queryOne(
    `
    SELECT COUNT(DISTINCT release_id) AS c
    FROM (
      SELECT release_id
      FROM outcome_alignments
      WHERE workspace_id = $1
        AND UPPER(COALESCE(actual_outcome, '')) = 'INCIDENT'
      UNION
      SELECT release_id
      FROM vcs_monitoring_windows
      WHERE workspace_id = $2
        AND UPPER(COALESCE(inferred_outcome, '')) = 'INCIDENT'
    ) incidents
  `,
    [workspaceId, workspaceId]
  );
  return Number(row?.c ?? 0);
}

async function getFalseCertificationRate(workspaceId) {
  const row = await queryOne(
    `
    SELECT
      COUNT(*) FILTER (WHERE alignment IN ('MISS', 'CORRECT', 'CAUTIOUS')) AS scored,
      COUNT(*) FILTER (WHERE alignment = 'MISS') AS misses
    FROM (
      SELECT alignment
      FROM outcome_alignments
      WHERE workspace_id = $1
      ORDER BY computed_at DESC
      LIMIT 50
    ) recent
  `,
    [workspaceId]
  );
  const scored = Number(row?.scored ?? 0);
  const misses = Number(row?.misses ?? 0);
  return {
    false_certification_rate_pct: computeFalseCertificationRatePct(misses, scored),
    false_certification_sample_count: scored
  };
}

async function getWorkspaceGovernanceStats(workspaceId) {
  const [production_incidents_count, debt, falseCert] = await Promise.all([
    countProductionIncidents(workspaceId),
    getWorkspaceRemediationDebt(workspaceId),
    getFalseCertificationRate(workspaceId)
  ]);
  return {
    production_incidents_count,
    remediation_debt_active: debt.active === true,
    false_certification_rate_pct: falseCert.false_certification_rate_pct,
    false_certification_sample_count: falseCert.false_certification_sample_count
  };
}

module.exports = {
  countProductionIncidents,
  getFalseCertificationRate,
  getWorkspaceGovernanceStats
};
