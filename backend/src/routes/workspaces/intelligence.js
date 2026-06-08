"use strict";

const { queryOne, queryAll } = require("../../database");
const {
  writeAudit,
  authMiddleware,
  requireNonViewer,
  requireWorkspaceMatch,
  computeAndPersistCorrelations,
  getCorrelations,
  getFailureModeTrends,
  computeOverrideAnalytics,
  computeSignalReliability,
  getSignalReliability,
  getReliabilitySummary,
  computeAndPersistRecommendation,
  getWorkspaceProductionHealth,
  OUTCOME_CRITERIA,
  getWorkspaceMonitoringSummary
} = require("../deps");
const { LOOP_BAND_THRESHOLDS, LOOP_ELIGIBILITY_MINUTES, loopEligibilityCutoffIso, computeLoopBand, computeLoopNextAction } = require("../../services/loopReadiness");

module.exports = function registerRoutes(app) {
app.post("/api/workspaces/:workspaceId/correlations/compute", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const { window_n = 20 } = req.body || {};
    const result = await computeAndPersistCorrelations(req.params.workspaceId, Math.min(50, Math.max(5, Number(window_n))));
    return res.json({ workspace_id: req.params.workspaceId, ...result });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/correlations", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const minAbs = Math.min(1, Math.max(0, Number(req.query.min_abs || 0.3)));
    const rows = await getCorrelations(req.params.workspaceId, minAbs);
    return res.json({ workspace_id: req.params.workspaceId, correlations: rows });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/failure-mode-trends", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const trends = await getFailureModeTrends(req.params.workspaceId);
    return res.json({ workspace_id: req.params.workspaceId, trends });
  } catch (e) {
    next(e);
  }
});
app.get("/api/workspaces/:workspaceId/override-analytics", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const result = await computeOverrideAnalytics(req.params.workspaceId);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

// ─── Signal Reliability ───────────────────────────────────────────────────────

app.post("/api/workspaces/:workspaceId/signal-reliability/compute", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const { window_n = 20 } = req.body || {};
    const results = await computeSignalReliability(req.params.workspaceId, Math.min(50, Math.max(3, Number(window_n))));
    return res.json({ workspace_id: req.params.workspaceId, signals: results });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/signal-reliability", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const signals = await getSignalReliability(req.params.workspaceId);
    const summary = await getReliabilitySummary(req.params.workspaceId);
    return res.json({ workspace_id: req.params.workspaceId, summary, signals });
  } catch (e) {
    next(e);
  }
});
/**
 * Backfill recommendations for all completed releases in a workspace that
 * don't have one yet. Safe to run multiple times (idempotent).
 */
app.post("/api/workspaces/:workspaceId/recommendations/backfill", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const VERDICTED = ["CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE"];
    const releases = await queryAll(
      `SELECT * FROM releases WHERE workspace_id = ? AND status IN (${VERDICTED.map(() => "?").join(",")})`,
      [req.params.workspaceId, ...VERDICTED]
    );

    let computed = 0;
    let skipped = 0;
    const errors = [];

    for (const release of releases) {
      try {
        await computeAndPersistRecommendation(release);
        computed++;
      } catch (err) {
        errors.push({ release_id: release.id, error: err.message });
        skipped++;
      }
    }

    return res.json({
      workspace_id: req.params.workspaceId,
      total: releases.length,
      computed,
      skipped,
      errors: errors.slice(0, 10)
    });
  } catch (e) {
    next(e);
  }
});
app.get("/api/workspaces/:workspaceId/production-health", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    return res.json(await getWorkspaceProductionHealth(req.params.workspaceId));
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/workspaces/:workspaceId/production-health/criteria
 * Returns the exact heuristic thresholds used to classify production outcomes.
 * Surfaces Fix #1: users can see exactly why MISS/HEALTHY/INCIDENT was assigned.
 */
app.get("/api/workspaces/:workspaceId/production-health/criteria", authMiddleware, requireWorkspaceMatch, (_req, res) => {
  return res.json({ outcome_classification_criteria: OUTCOME_CRITERIA });
});
app.get("/api/workspaces/:workspaceId/loop-readiness", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
  const wsId = req.params.workspaceId;
  const eligibleCutoff = loopEligibilityCutoffIso();

  // All releases in this workspace
  const trRow = await queryOne("SELECT COUNT(*) AS c FROM releases WHERE workspace_id = ?", [wsId]);
  const totalReleases = Number(trRow?.c ?? 0);

  // Releases with a verdict issued (regardless of age)
  const viRow = await queryOne(
    "SELECT COUNT(*) AS c FROM releases WHERE workspace_id = ? AND verdict_issued_at IS NOT NULL",
    [wsId]
  );
  const verdictIssued = Number(viRow?.c ?? 0);

  // Eligible releases: verdict issued more than LOOP_ELIGIBILITY_MINUTES ago
  const elRow = await queryOne(
    `SELECT COUNT(*) AS c FROM releases
              WHERE workspace_id = ? AND verdict_issued_at IS NOT NULL
              AND verdict_issued_at::timestamptz <= ?::timestamptz`,
    [wsId, eligibleCutoff]
  );
  const eligible = Number(elRow?.c ?? 0);

  // Eligible releases that have at least one production observation
  const woRow = await queryOne(
    `SELECT COUNT(DISTINCT po.release_id) AS c
              FROM production_observations po
              JOIN releases r ON r.id = po.release_id
              WHERE r.workspace_id = ?
              AND r.verdict_issued_at IS NOT NULL
              AND r.verdict_issued_at::timestamptz <= ?::timestamptz`,
    [wsId, eligibleCutoff]
  );
  const withObservations = Number(woRow?.c ?? 0);

  // Eligible releases with a computed alignment (full loop = verdict + observation + alignment)
  const waRow = await queryOne(
    `SELECT COUNT(DISTINCT oa.release_id) AS c
              FROM outcome_alignments oa
              JOIN releases r ON r.id = oa.release_id
              WHERE r.workspace_id = ?
              AND r.verdict_issued_at IS NOT NULL
              AND r.verdict_issued_at::timestamptz <= ?::timestamptz`,
    [wsId, eligibleCutoff]
  );
  const withAlignment = Number(waRow?.c ?? 0);

  const fullLoopCount = withAlignment; // alignment implies verdict + observation + alignment
  const fullLoopRatePct = eligible > 0 ? Math.round((fullLoopCount / eligible) * 100) : 0;

  // Age of the most recent full loop
  const lastLoopRow = await queryOne(
    `SELECT oa.computed_at
              FROM outcome_alignments oa
              JOIN releases r ON r.id = oa.release_id
              WHERE r.workspace_id = ?
              AND r.verdict_issued_at IS NOT NULL
              AND r.verdict_issued_at::timestamptz <= ?::timestamptz
              ORDER BY oa.computed_at::timestamptz DESC
              LIMIT 1`,
    [wsId, eligibleCutoff]
  );
  const lastFullLoopAt = lastLoopRow?.computed_at ?? null;
  const lastFullLoopDaysAgo = lastFullLoopAt
    ? Math.floor((Date.now() - Date.parse(lastFullLoopAt)) / (24 * 60 * 60 * 1000))
    : null;

  // Quality band
  const band = computeLoopBand(fullLoopCount, fullLoopRatePct);

  // Stale: any band, no full loop in 90 days
  const isStale = lastFullLoopDaysAgo !== null && lastFullLoopDaysAgo > LOOP_BAND_THRESHOLDS.stale_threshold_days;

  // Has observations but no full loops (VCS integration working but alignment not triggering)
  const observationsWithoutAlignment = Math.max(0, withObservations - withAlignment);

  return res.json({
    workspace_id: wsId,
    band,                          // "Exploratory" | "Emerging" | "Reliable"
    is_stale: isStale,             // true if last full loop > 90 days ago
    // Counts
    total_releases: totalReleases,
    verdict_issued: verdictIssued,
    eligible_releases: eligible,
    eligibility_minutes: LOOP_ELIGIBILITY_MINUTES,
    with_production_observations: withObservations,
    with_alignment: withAlignment,
    full_loop_count: fullLoopCount,
    full_loop_rate_pct: fullLoopRatePct,
    observations_without_alignment: observationsWithoutAlignment,
    // Recency
    last_full_loop_at: lastFullLoopAt,
    last_full_loop_days_ago: lastFullLoopDaysAgo,
    // Thresholds (surfaced for transparency — these are fixed)
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
  });
  } catch (e) {
    next(e);
  }
});
app.get("/api/workspaces/:workspaceId/vcs-monitor", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    return res.json(await getWorkspaceMonitoringSummary(req.params.workspaceId));
  } catch (e) {
    next(e);
  }
});
};
