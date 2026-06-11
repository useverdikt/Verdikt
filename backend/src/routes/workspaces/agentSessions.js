"use strict";

const { authMiddleware, requireWorkspaceMatch } = require("../../middleware/auth");
const { getAgentSessionAuditTrail } = require("../../services/agentSession");

module.exports = function registerAgentSessionRoutes(app) {
  /** Chain of evidence for one agent session (human session or API key with matching workspace). */
  app.get(
    "/api/workspaces/:workspaceId/agent-sessions/:sessionId/audit",
    authMiddleware,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const limit = parseInt(String(req.query.limit || "100"), 10) || 100;
        const trail = await getAgentSessionAuditTrail(req.params.workspaceId, req.params.sessionId, { limit });
        if (!trail) {
          return res.status(404).json({ error: "agent session not found" });
        }
        return res.json({
          workspace_id: req.params.workspaceId,
          ...trail
        });
      } catch (e) {
        next(e);
      }
    }
  );
};
