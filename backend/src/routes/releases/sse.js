"use strict";

const {
  sendError,
  authMiddleware,
  requireNonViewer,
  requireReleaseAccess,
  issueStreamToken,
  validateStreamToken,
  attachStream
} = require("./_shared");

module.exports = function registerRoutes(app) {
  app.post("/api/releases/:releaseId/sse-token", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
    try {
      const { token, expires_at } = await issueStreamToken(req.params.releaseId, req.auth.ws);
      return res.json({ token, expires_at, stream_url: `/api/releases/${req.params.releaseId}/stream` });
    } catch (e) {
      next(e);
    }
  });

  /** SSE stream endpoint — token-authenticated (no Bearer needed, for EventSource compat). */
  app.get("/api/releases/:releaseId/stream", async (req, res) => {
    const { token } = req.query;
    const { valid, reason } = await validateStreamToken(token, req.params.releaseId);
    if (!valid) {
      return sendError(res, req, 401, "unauthorized", {
        message: `Unauthorized: ${reason || "invalid_token"}`,
        details: reason ? { reason } : undefined
      });
    }
    await attachStream(req.params.releaseId, res);
  });
  /** Allow setting commit_sha and pr_number on a release (for VCS write-back). */
};
