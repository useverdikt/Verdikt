"use strict";

const { queryOne } = require("../database");

const DEBT_LOOKBACK_DAYS = 7;

/**
 * Workspace carries remediation debt after an emergency merge (shipped without certification).
 * Next releases cannot merge on override until debt clears.
 */
async function getWorkspaceRemediationDebt(workspaceId) {
  const row = await queryOne(
    `
    SELECT id, version, shipped_without_certification_at
    FROM releases
    WHERE workspace_id = ?
      AND shipped_without_certification = 1
      AND shipped_without_certification_at IS NOT NULL
      AND shipped_without_certification_at::timestamptz >= NOW() - INTERVAL '${DEBT_LOOKBACK_DAYS} days'
    ORDER BY shipped_without_certification_at DESC
    LIMIT 1
  `,
    [workspaceId]
  );

  if (!row) {
    return { active: false, lookback_days: DEBT_LOOKBACK_DAYS };
  }

  return {
    active: true,
    lookback_days: DEBT_LOOKBACK_DAYS,
    source_release_id: row.id,
    source_version: row.version,
    since: row.shipped_without_certification_at,
    message: `Remediation debt active from emergency merge without certification (${row.version}). Override merges blocked — ship CERTIFIED to recover.`
  };
}

module.exports = { getWorkspaceRemediationDebt, DEBT_LOOKBACK_DAYS };
