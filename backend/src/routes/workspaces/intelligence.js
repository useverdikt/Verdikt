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
const { computeWorkspaceLoopReadiness } = require("../../services/loopReadinessStats");

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
    return res.json(await computeWorkspaceLoopReadiness(req.params.workspaceId));
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
