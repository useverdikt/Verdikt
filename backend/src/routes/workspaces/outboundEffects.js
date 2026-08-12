"use strict";

const {
  authMiddleware,
  requireHumanSession,
  requireWorkspaceMatch
} = require("../deps");
const { getOutboundEffectReadiness } = require("../../services/outboundEffectReadiness");

module.exports = function registerRoutes(app) {
  app.get(
    "/api/workspaces/:workspaceId/outbound-effects/readiness",
    authMiddleware,
    requireHumanSession,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const result = await getOutboundEffectReadiness(req.params.workspaceId, {
          windowDays: req.query.window_days
        });
        return res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );
};
