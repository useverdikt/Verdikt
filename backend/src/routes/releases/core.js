"use strict";

const {
  sendError,
  authMiddleware,
  requireReleaseAccess,
  verifyCertificationRecord,
  getCertSignaturePublic,
  gatePollRateLimit,
  buildReleaseGateResponse,
  buildReleaseBriefWithAudit,
  buildReleaseSummary,
  buildReleaseDetail,
  listReleaseAuditEvents
} = require("./_shared");

module.exports = function registerRoutes(app) {
  app.get("/api/releases/:releaseId/summary", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
      return res.json(await buildReleaseSummary(req.releaseRow));
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/releases/:releaseId/detail", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
      return res.json(await buildReleaseDetail(req.releaseRow));
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/releases/:releaseId/audit", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
      const { events, next_before } = await listReleaseAuditEvents(req.params.releaseId, {
        limit: req.query.limit,
        before: req.query.before
      });
      return res.json({
        release_id: req.params.releaseId,
        events,
        next_before
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/releases/:releaseId", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
    const detail = await buildReleaseDetail(req.releaseRow);
    const { events: audit } = await listReleaseAuditEvents(req.params.releaseId, { limit: 50 });

    return res.json({ ...detail, audit });
    } catch (e) {
      next(e);
    }
  });


  app.get("/api/releases/:releaseId/gate", authMiddleware, requireReleaseAccess, gatePollRateLimit, async (req, res, next) => {
    try {
      const mode =
        req.query.mode === "strict"
          ? "strict"
          : req.query.mode === "default"
            ? "default"
            : undefined;
      const payload = await buildReleaseGateResponse(req.releaseRow, { mode, auth: req.auth });
      return res.json(payload);
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/releases/:releaseId/release-brief", authMiddleware, requireReleaseAccess, async (req, res, next) => {
    try {
      const mode =
        req.query.mode === "strict"
          ? "strict"
          : req.query.mode === "default"
            ? "default"
            : undefined;
      const payload = await buildReleaseBriefWithAudit(req.releaseRow, { mode, auth: req.auth });
      return res.json(payload);
    } catch (e) {
      next(e);
    }
  });

  // ─── Certification Signing ────────────────────────────────────────────────────

  /** Public: verify a certification record's cryptographic signature. No auth required. */
  app.get("/api/releases/:releaseId/cert/verify", async (req, res, next) => {
    try {
      const result = await verifyCertificationRecord(req.params.releaseId);
      const sig = await getCertSignaturePublic(req.params.releaseId);
      return res.json({ release_id: req.params.releaseId, verification: result, signature: sig });
    } catch (e) {
      next(e);
    }
  });

  /** Public: get the cert signature record for embedding in badges. */
  app.get("/api/releases/:releaseId/cert/signature", async (req, res, next) => {
    try {
      const sig = await getCertSignaturePublic(req.params.releaseId);
      if (!sig) return sendError(res, req, 404, "no signature on record for this release");
      return res.json(sig);
    } catch (e) {
      next(e);
    }
  });
  // ─── Early Warnings ───────────────────────────────────────────────────────────
};
