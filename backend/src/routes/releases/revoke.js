"use strict";

const { parseRequestBody } = require("../../lib/requestValidation");
const { revokeBodySchema } = require("../../schemas/governanceRequestSchemas");
const {
  getUserRowForAuthById,
  sendError,
  authMiddleware,
  requireHumanSession,
  requireReleaseAccess,
  requireOverrideApproverRole
} = require("./_shared");
const { revokeReleaseCertification } = require("../../services/releaseRevoke");

module.exports = function registerRoutes(app) {
  app.post(
    "/api/releases/:releaseId/revoke-certification",
    authMiddleware,
    requireHumanSession,
    requireReleaseAccess,
    requireOverrideApproverRole,
    async (req, res, next) => {
      try {
        const parsedBody = parseRequestBody(revokeBodySchema, req, res, {
          message: "invalid revoke request body"
        });
        if (!parsedBody.ok) return;
        const { justification } = parsedBody.data;
        const authUser = await getUserRowForAuthById(req.auth.sub);
        const actorName = authUser?.name || authUser?.email || req.auth.email;
        const actorRole = authUser?.role || req.auth.role;

        const out = await revokeReleaseCertification(req.releaseRow, {
          actorName,
          actorRole,
          justification
        });
        if (!out.ok) {
          return sendError(res, req, out.statusCode || 400, out.error);
        }

        return res.json({
          release_id: out.release_id,
          status: out.status,
          prior_status: out.prior_status
        });
      } catch (e) {
        next(e);
      }
    }
  );
};
