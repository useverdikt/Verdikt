"use strict";

const {
  sendError,
  nowIso,
  writeAudit,
  auditActorFromAuth,
  authMiddleware,
  requireHumanSession,
  requireNonViewer,
  requireReleaseAccess,
  getReleaseIntelligence,
  upsertReleaseIntelligence,
  getEarlyWarning,
  getFailureModes,
  computeAndPersistRecommendation,
  getRecommendationForRelease
} = require("./_shared");

module.exports = function registerRoutes(app) {
  app.get("/api/releases/:releaseId/intelligence", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
    const intelligence = await getReleaseIntelligence(req.params.releaseId);
    return res.json({
      release_id: req.params.releaseId,
      workspace_id: req.releaseRow.workspace_id,
      intelligence: intelligence || {
        verdict: null,
        override: null,
        created_at: null,
        updated_at: null
      }
    });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/releases/:releaseId/regression-history", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
      const { computeRegressionHistoryInsights } = require("../services/intelligenceBuilder");
      const release = req.releaseRow;
      const intelligence = await getReleaseIntelligence(req.params.releaseId);
      const verdict = intelligence?.verdict;

      // Extract the signals that failed with a regression kind from stored intelligence
      const failedSignals = verdict?.failed_signals || [];
      const regressionSignalIds = failedSignals
        .filter((s) => s.failure_kind === "regression" || String(s.rule || "").startsWith("regression:"))
        .map((s) => s.signal_id)
        .filter(Boolean);

      // If there's already a regression_history in the stored verdict, return it directly
      if (verdict?.regression_history) {
        return res.json({
          release_id: req.params.releaseId,
          release_type: release.release_type,
          status: release.status,
          regression_history: verdict.regression_history,
          failed_signals: failedSignals.filter((s) => regressionSignalIds.includes(s.signal_id))
        });
      }

      // Otherwise compute on demand (useful for agents that call this before a verdict is cached)
      const candidateIds = regressionSignalIds.length
        ? regressionSignalIds
        : failedSignals.map((s) => s.signal_id).filter(Boolean);

      const history = candidateIds.length
        ? await computeRegressionHistoryInsights(release.workspace_id, req.params.releaseId, release.release_type, candidateIds)
        : null;

      return res.json({
        release_id: req.params.releaseId,
        release_type: release.release_type,
        status: release.status,
        regression_history: history,
        failed_signals: failedSignals.filter((s) => candidateIds.includes(s.signal_id))
      });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/releases/:releaseId/intelligence/decision", authMiddleware, requireHumanSession, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
    try {
    const { decision, notes = "" } = req.body || {};
    const allowed = new Set(["applied", "dismissed", "overridden", "shipped"]);
    if (!allowed.has(String(decision))) {
      return sendError(res, req, 400, "decision must be one of: applied, dismissed, overridden, shipped");
    }
    const actor = auditActorFromAuth(req.auth);
    const payload = {
      decision: String(decision),
      notes: String(notes || "").slice(0, 2000),
      actor: actor.actorName,
      decided_at: nowIso()
    };
    await upsertReleaseIntelligence(req.params.releaseId, req.releaseRow.workspace_id, { decision: payload });
    await writeAudit({
      workspaceId: req.releaseRow.workspace_id,
      releaseId: req.params.releaseId,
      eventType: "INTELLIGENCE_DECISION_RECORDED",
      actorType: actor.actorType,
      actorName: actor.actorName,
      details: payload
    });
    return res.json({ release_id: req.params.releaseId, decision: payload });
    } catch (e) {
      next(e);
    }
  });

  app.post("/api/releases/:releaseId/intelligence/outcome", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
    try {
    const { label, notes = "", observed_at } = req.body || {};
    const allowed = new Set(["incident", "no_incident", "followup_met"]);
    if (!allowed.has(String(label))) {
      return sendError(res, req, 400, "label must be one of: incident, no_incident, followup_met");
    }
    const payload = {
      label: String(label),
      notes: String(notes || "").slice(0, 2000),
      observed_at: typeof observed_at === "string" && observed_at.trim() ? observed_at.trim() : nowIso(),
      recorded_at: nowIso()
    };
    await upsertReleaseIntelligence(req.params.releaseId, req.releaseRow.workspace_id, { outcome: payload });
    const actor = auditActorFromAuth(req.auth);
    await writeAudit({
      workspaceId: req.releaseRow.workspace_id,
      releaseId: req.params.releaseId,
      eventType: "INTELLIGENCE_OUTCOME_RECORDED",
      actorType: actor.actorType,
      actorName: actor.actorName,
      details: payload
    });
    return res.json({ release_id: req.params.releaseId, outcome: payload });
    } catch (e) {
      next(e);
    }
  });


  app.get("/api/releases/:releaseId/early-warning", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
      const ew = await getEarlyWarning(req.params.releaseId);
      if (!ew) return sendError(res, req, 404, "no early warning computed for this release yet");
      return res.json(ew);
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/releases/:releaseId/failure-modes", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
      const modes = await getFailureModes(req.params.releaseId);
      return res.json({ release_id: req.params.releaseId, failure_modes: modes });
    } catch (e) {
      next(e);
    }
  });
  /** Extend the collection deadline while a release is still COLLECTING. */

  app.get("/api/releases/:releaseId/recommendation", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
      const rec = await getRecommendationForRelease(req.releaseRow);
      if (!rec) return sendError(res, req, 404, "no recommendation computed for this release yet");
      return res.json({ release_id: req.params.releaseId, ...rec });
    } catch (e) {
      next(e);
    }
  });

  /** Force-recompute a recommendation for a release (e.g. after reliability scores are updated). */
  app.post("/api/releases/:releaseId/recommendation/compute", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
    try {
      const rec = await computeAndPersistRecommendation(req.releaseRow);
      return res.json({ release_id: req.params.releaseId, ...rec });
    } catch (err) {
      next(err);
    }
  });
  // ─── Production Feedback Loop ─────────────────────────────────────────────────
};
