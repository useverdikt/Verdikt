"use strict";

const { queryOne } = require("../database");
const { getWorkspaceRemediationDebt } = require("./remediationDebt");

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

async function getWorkspaceGovernanceStats(workspaceId) {
  const [production_incidents_count, debt] = await Promise.all([
    countProductionIncidents(workspaceId),
    getWorkspaceRemediationDebt(workspaceId)
  ]);
  return {
    production_incidents_count,
    remediation_debt_active: debt.active === true
  };
}

module.exports = {
  countProductionIncidents,
  getWorkspaceGovernanceStats
};
