"use strict";

const { queryOne } = require("../database");
const {
  LOOP_BAND_THRESHOLDS,
  LOOP_ELIGIBILITY_MINUTES,
  loopEligibilityCutoffIso,
  computeLoopBand,
  computeLoopNextAction
} = require("./loopReadiness");

const LOOP_READINESS_SQL = `
  WITH eligible AS (
    SELECT r.id
    FROM releases r
    WHERE r.workspace_id = $1
      AND r.verdict_issued_at IS NOT NULL
      AND r.verdict_issued_at <= $2
  ),
  obs AS (
    SELECT COUNT(DISTINCT po.release_id) AS c
    FROM production_observations po
    JOIN eligible e ON e.id = po.release_id
  ),
  aligned AS (
    SELECT COUNT(DISTINCT oa.release_id) AS c,
           MAX(oa.computed_at) AS last_at
    FROM outcome_alignments oa
    JOIN eligible e ON e.id = oa.release_id
  )
  SELECT
    (SELECT COUNT(*) FROM releases WHERE workspace_id = $3) AS total_releases,
    (SELECT COUNT(*) FROM releases WHERE workspace_id = $4 AND verdict_issued_at IS NOT NULL) AS verdict_issued,
    (SELECT COUNT(*) FROM eligible) AS eligible_releases,
    (SELECT c FROM obs) AS with_production_observations,
    (SELECT c FROM aligned) AS with_alignment,
    (SELECT last_at FROM aligned) AS last_full_loop_at
`;

async function computeWorkspaceLoopReadiness(workspaceId, nowMs = Date.now()) {
  const eligibleCutoff = loopEligibilityCutoffIso(nowMs);
  const row = await queryOne(LOOP_READINESS_SQL, [
    workspaceId,
    eligibleCutoff,
    workspaceId,
    workspaceId
  ]);

  const totalReleases = Number(row?.total_releases ?? 0);
  const verdictIssued = Number(row?.verdict_issued ?? 0);
  const eligible = Number(row?.eligible_releases ?? 0);
  const withObservations = Number(row?.with_production_observations ?? 0);
  const withAlignment = Number(row?.with_alignment ?? 0);
  const fullLoopCount = withAlignment;
  const fullLoopRatePct = eligible > 0 ? Math.round((fullLoopCount / eligible) * 100) : 0;
  const lastFullLoopAt = row?.last_full_loop_at ?? null;
  const lastFullLoopDaysAgo = lastFullLoopAt
    ? Math.floor((nowMs - Date.parse(lastFullLoopAt)) / (24 * 60 * 60 * 1000))
    : null;
  const band = computeLoopBand(fullLoopCount, fullLoopRatePct);
  const isStale =
    lastFullLoopDaysAgo !== null && lastFullLoopDaysAgo > LOOP_BAND_THRESHOLDS.stale_threshold_days;
  const observationsWithoutAlignment = Math.max(0, withObservations - withAlignment);

  return {
    workspace_id: workspaceId,
    band,
    is_stale: isStale,
    total_releases: totalReleases,
    verdict_issued: verdictIssued,
    eligible_releases: eligible,
    eligibility_minutes: LOOP_ELIGIBILITY_MINUTES,
    with_production_observations: withObservations,
    with_alignment: withAlignment,
    full_loop_count: fullLoopCount,
    full_loop_rate_pct: fullLoopRatePct,
    observations_without_alignment: observationsWithoutAlignment,
    last_full_loop_at: lastFullLoopAt,
    last_full_loop_days_ago: lastFullLoopDaysAgo,
    band_thresholds: {
      exploratory_max: LOOP_BAND_THRESHOLDS.exploratory_max,
      emerging_min_loops: LOOP_BAND_THRESHOLDS.exploratory_max + 1,
      reliable_min_loops: LOOP_BAND_THRESHOLDS.reliable_min_loops,
      reliable_min_rate_pct: LOOP_BAND_THRESHOLDS.reliable_min_rate_pct,
      stale_threshold_days: LOOP_BAND_THRESHOLDS.stale_threshold_days
    },
    next_action: computeLoopNextAction({
      fullLoopCount,
      fullLoopRatePct,
      verdictIssued,
      withObservations,
      isStale
    })
  };
}

module.exports = { computeWorkspaceLoopReadiness };
