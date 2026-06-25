"use strict";

const { queryOne } = require("../database");

const DEBT_LOOKBACK_DAYS = 7;

/**
 * Workspace carries remediation debt after an emergency merge (shipped without certification).
 * Debt clears when a clean CERTIFIED prod release ships after the bypass, or when the
 * lookback window expires.
 */
async function getWorkspaceRemediationDebt(workspaceId) {
  const bypass = await queryOne(
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

  if (!bypass) {
    return { active: false, lookback_days: DEBT_LOOKBACK_DAYS };
  }

  const recovery = await queryOne(
    `
    SELECT id, version, verdict_issued_at, updated_at
    FROM releases
    WHERE workspace_id = ?
      AND status = 'CERTIFIED'
      AND environment = 'prod'
      AND COALESCE(shipped_without_certification, 0) = 0
      AND COALESCE(verdict_issued_at, updated_at)::timestamptz >= ?::timestamptz
    ORDER BY COALESCE(verdict_issued_at, updated_at)::timestamptz DESC
    LIMIT 1
  `,
    [workspaceId, bypass.shipped_without_certification_at]
  );

  if (recovery) {
    return {
      active: false,
      lookback_days: DEBT_LOOKBACK_DAYS,
      cleared: true,
      cleared_by_release_id: recovery.id,
      cleared_by_version: recovery.version,
      source_release_id: bypass.id,
      source_version: bypass.version,
      since: bypass.shipped_without_certification_at
    };
  }

  return {
    active: true,
    lookback_days: DEBT_LOOKBACK_DAYS,
    source_release_id: bypass.id,
    source_version: bypass.version,
    since: bypass.shipped_without_certification_at,
    message: `Remediation debt active from emergency merge without certification (${bypass.version}). Non-emergency merges blocked — ship a clean CERTIFIED prod release to recover.`
  };
}

module.exports = { getWorkspaceRemediationDebt, DEBT_LOOKBACK_DAYS };
