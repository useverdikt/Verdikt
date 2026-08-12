"use strict";

const { parseRequestBody } = require("../../lib/requestValidation");
const {
  overrideBodySchema
} = require("../../schemas/governanceRequestSchemas");
const {
  getUserRowForAuthById,
  sendError,
  writeAudit,
  authMiddleware,
  requireHumanSession,
  requireNonViewer,
  requireReleaseAccess,
  requireOverrideApproverRole,
  createEscalationRequest,
  notifyEscalationCreated,
  applyReleaseOverride
} = require("./_shared");

module.exports = function registerRoutes(app) {
  app.post("/api/releases/:releaseId/override", authMiddleware, requireHumanSession, requireReleaseAccess, requireOverrideApproverRole, async (req, res, next) => {
    try {
      const parsedBody = parseRequestBody(overrideBodySchema, req, res, {
        message: "invalid override request body"
      });
      if (!parsedBody.ok) return;
      const {
        approver_type = "PERSON",
        justification,
        metadata = {}
      } = parsedBody.data;
      const authUser = await getUserRowForAuthById(req.auth.sub);
      const approver_name = authUser?.name || authUser?.email || req.auth.email;
      const approver_role = authUser?.role || req.auth.role;

      const out = await applyReleaseOverride(req.releaseRow, {
        approver_type,
        approver_name,
        approver_role,
        justification,
        metadata
      });
      if (!out.ok) {
        return sendError(res, req, out.statusCode || 400, out.error);
      }

      return res.json({
        release_id: out.release_id,
        status: out.status,
        assistive: out.assistive,
        cert_signature: out.cert_signature
      });
    } catch (e) {
      next(e);
    }
  });


  app.post("/api/releases/:releaseId/escalate", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
    try {
      const release = req.releaseRow;
      const { reason, blocking_signals = [], attempted_fixes = [] } = req.body || {};
      const justification = String(reason || "").trim();
      if (!justification) {
        return sendError(res, req, 400, "reason is required");
      }
      if (release.status === "CERTIFIED" || release.status === "CERTIFIED_WITH_OVERRIDE") {
        return sendError(res, req, 400, "release is already certified; escalation not needed");
      }

      const actorType = req.auth?.authType === "api_key" ? "AGENT" : "USER";
      const actorName =
        req.auth?.authType === "api_key"
          ? req.auth.apiKeyName || "agent_runtime"
          : req.auth.email || "user";

      await writeAudit({
        workspaceId: release.workspace_id,
        releaseId: req.params.releaseId,
        eventType: "ESCALATION_REQUESTED",
        actorType,
        actorName,
        details: {
          reason: justification.slice(0, 2000),
          blocking_signals: Array.isArray(blocking_signals) ? blocking_signals : [],
          attempted_fixes: Array.isArray(attempted_fixes) ? attempted_fixes : [],
          status: release.status
        }
      });

      const { escalation, reused } = await createEscalationRequest({
        workspaceId: release.workspace_id,
        releaseId: req.params.releaseId,
        reason: justification,
        blockingSignals: Array.isArray(blocking_signals) ? blocking_signals : [],
        attemptedFixes: Array.isArray(attempted_fixes) ? attempted_fixes : [],
        requestedByType: actorType,
        requestedByName: actorName,
        releaseStatus: release.status
      });

      void notifyEscalationCreated({
        workspaceId: release.workspace_id,
        releaseId: req.params.releaseId,
        escalation,
        releaseRow: release
      }).catch((err) => {
        console.error("[escalation_email]", req.params.releaseId, err);
      });

      return res.status(202).json({
        release_id: req.params.releaseId,
        status: release.status,
        escalation: {
          id: escalation.id,
          state: escalation.state,
          reason: escalation.reason,
          sla_due_at: escalation.sla_due_at,
          reused
        }
      });
    } catch (e) {
      next(e);
    }
  });

};
