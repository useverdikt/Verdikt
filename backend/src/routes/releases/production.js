"use strict";

const {
  sendError,
  authMiddleware,
  requireHumanSession,
  requireNonViewer,
  requireReleaseAccess,
  ingestProductionSignals,
  getProductionObservations,
  computeOutcomeAlignment,
  setIncidentRef,
  openMonitoringWindow,
  scanWindow,
  getMonitoringWindow
} = require("./_shared");

module.exports = function registerRoutes(app) {
  // ─── Recommendation Engine ────────────────────────────────────────────────────

  /** Get the structured recommendation for a release (cached from last verdict). */

  app.post("/api/releases/:releaseId/production-signals", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
    try {
    const { signals, source, idempotency_key: bodyKey, metadata } = req.body || {};
    const releaseId = req.params.releaseId;
    const workspaceId = req.releaseRow.workspace_id;

    if (!signals || typeof signals !== "object" || Array.isArray(signals)) {
      return sendError(res, req, 400, "signals object is required");
    }

    const idempotencyKey = req.headers["x-idempotency-key"] || bodyKey || null;

    const result = await ingestProductionSignals(releaseId, workspaceId, signals, {
      source: source || "webhook",
      idempotencyKey,
      metadata: metadata || null
    });

    if (result.inserted.length === 0 && result.duplicates.length > 0) {
      return sendError(res, req, 409, "duplicate_request", {
        message: "All signals already recorded under this idempotency key.",
        details: { idempotency_key: idempotencyKey, duplicates: result.duplicates }
      });
    }

    return res.json({
      release_id: releaseId,
      inserted: result.inserted,
      duplicates: result.duplicates,
      errors: result.errors,
      idempotency_key: idempotencyKey
    });
    } catch (e) {
      next(e);
    }
  });

  /**
   * GET /api/releases/:releaseId/production-signals
   * Retrieve production observations for a specific release.
   */
  app.get("/api/releases/:releaseId/production-signals", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
    const observations = await getProductionObservations(req.params.releaseId);
    return res.json({ release_id: req.params.releaseId, observations });
    } catch (e) {
      next(e);
    }
  });

  /**
   * POST /api/releases/:releaseId/production-signals/align
   * Manually trigger outcome alignment computation for a release.
   */
  app.post("/api/releases/:releaseId/production-signals/align", authMiddleware, requireHumanSession, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
    try {
    const result = await computeOutcomeAlignment(req.params.releaseId, req.releaseRow.workspace_id);
    if (!result) return sendError(res, req, 422, "No production observations found for this release yet.");
    return res.json(result);
    } catch (e) {
      next(e);
    }
  });

  /**
   * PUT /api/releases/:releaseId/production-signals/incident
   * Link a post-mortem incident reference to a release's outcome alignment.
   * Body: { incident_ref: string }  — any string (Jira, PagerDuty, URL, etc.)
   */
  app.put("/api/releases/:releaseId/production-signals/incident", authMiddleware, requireHumanSession, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
    try {
    const { incident_ref } = req.body || {};
    if (!incident_ref || typeof incident_ref !== "string" || !incident_ref.trim()) {
      return sendError(res, req, 400, "incident_ref (non-empty string) is required");
    }
    const result = await setIncidentRef(req.params.releaseId, req.releaseRow.workspace_id, incident_ref.trim());
    return res.json(result);
    } catch (e) {
      next(e);
    }
  });
  // ─── VCS Automatic Production Monitoring ─────────────────────────────────────

  /**
   * GET /api/releases/:releaseId/vcs-monitor
   * Get the VCS monitoring window status for a specific release.
   */
  app.get("/api/releases/:releaseId/vcs-monitor", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
    const window = await getMonitoringWindow(req.params.releaseId);
    if (!window) return sendError(res, req, 404, "No monitoring window found for this release.");
    return res.json(window);
    } catch (e) {
      next(e);
    }
  });

  /**
   * POST /api/releases/:releaseId/vcs-monitor/scan
   * Manually trigger an immediate VCS scan for a release (useful for testing).
   */
  app.post("/api/releases/:releaseId/vcs-monitor/scan", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
    try {
      let window = await getMonitoringWindow(req.params.releaseId);

      if (!window) {
        const release = req.releaseRow;
        await openMonitoringWindow(release, 120);
        window = await getMonitoringWindow(req.params.releaseId);
      }

      if (!window || window.status === "no_sha") {
        return sendError(res, req, 422, "Release has no commit_sha — VCS monitoring requires a commit SHA.");
      }
      if (window.status === "no_vcs") {
        return sendError(res, req, 422, "No VCS integration configured for this workspace. Connect GitHub or GitLab in settings.");
      }

      const newStatus = await scanWindow(window);
      return res.json({
        release_id: req.params.releaseId,
        status: newStatus,
        window: await getMonitoringWindow(req.params.releaseId)
      });
    } catch (err) {
      next(err);
    }
  });
};
