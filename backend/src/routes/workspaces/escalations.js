"use strict";

const {
  authMiddleware,
  requireWorkspaceMatch,
  requireOverrideApproverRole
} = require("../deps");
const { listEscalationsForWorkspace, acknowledgeEscalation } = require("../../services/escalations");

module.exports = function registerEscalationRoutes(app) {
  app.get("/api/workspaces/:workspaceId/escalations", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
    try {
      const state =
        typeof req.query.state === "string" && req.query.state.trim()
          ? req.query.state.trim()
          : "pending_human_review";
      const limit = req.query.limit;
      const escalations = await listEscalationsForWorkspace(req.params.workspaceId, { state, limit });
      const pendingCount = escalations.filter((e) => e.state === "pending_human_review").length;
      return res.json({
        workspace_id: req.params.workspaceId,
        state_filter: state,
        pending_count: state === "pending_human_review" ? escalations.length : pendingCount,
        escalations
      });
    } catch (e) {
      next(e);
    }
  });

  app.post(
    "/api/workspaces/:workspaceId/escalations/:escalationId/acknowledge",
    authMiddleware,
    requireOverrideApproverRole,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const { note = "" } = req.body || {};
        const out = await acknowledgeEscalation({
          workspaceId: req.params.workspaceId,
          escalationId: req.params.escalationId,
          actorEmail: req.auth?.email || "user",
          note
        });
        if (!out.ok) {
          const code = out.error === "not_found" ? 404 : 409;
          return res.status(code).json({ error: out.error, state: out.state });
        }
        return res.json({ ok: true, escalation: out.escalation });
      } catch (e) {
        next(e);
      }
    }
  );
};
