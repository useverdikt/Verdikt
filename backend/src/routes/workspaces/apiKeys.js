"use strict";

const {
  authMiddleware,
  requireNonViewer,
  requireHumanSession,
  requireWorkspaceMatch
} = require("../../middleware/auth");
const {
  createWorkspaceApiKey,
  listWorkspaceApiKeys,
  revokeWorkspaceApiKey
} = require("../../services/apiKeys");
const { writeAudit } = require("../../services/audit");

module.exports = function registerApiKeyRoutes(app) {
  app.get("/api/workspaces/:workspaceId/api-keys", authMiddleware, requireHumanSession, requireWorkspaceMatch, async (req, res, next) => {
    try {
      const keys = await listWorkspaceApiKeys(req.params.workspaceId);
      return res.json({ workspace_id: req.params.workspaceId, api_keys: keys });
    } catch (e) {
      next(e);
    }
  });

  app.post(
    "/api/workspaces/:workspaceId/api-keys",
    authMiddleware,
    requireHumanSession,
    requireNonViewer,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const { name } = req.body || {};
        const created = await createWorkspaceApiKey({
          workspaceId: req.params.workspaceId,
          name,
          createdByUserId: req.auth.sub
        });
        await writeAudit({
          workspaceId: req.params.workspaceId,
          releaseId: null,
          eventType: "API_KEY_CREATED",
          actorType: "USER",
          actorName: req.auth.email || "user",
          details: { api_key_id: created.id, name: created.name, key_prefix: created.key_prefix }
        });
        return res.status(201).json({
          id: created.id,
          workspace_id: created.workspace_id,
          name: created.name,
          key_prefix: created.key_prefix,
          api_key: created.api_key,
          created_at: created.created_at,
          message: "Store this key now — it will not be shown again."
        });
      } catch (e) {
        if (e?.message === "name is required") {
          return res.status(400).json({ error: e.message });
        }
        next(e);
      }
    }
  );

  app.delete(
    "/api/workspaces/:workspaceId/api-keys/:keyId",
    authMiddleware,
    requireHumanSession,
    requireNonViewer,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const result = await revokeWorkspaceApiKey(req.params.workspaceId, req.params.keyId);
        if (!result) return res.status(404).json({ error: "API key not found" });
        await writeAudit({
          workspaceId: req.params.workspaceId,
          releaseId: null,
          eventType: "API_KEY_REVOKED",
          actorType: "USER",
          actorName: req.auth.email || "user",
          details: { api_key_id: req.params.keyId }
        });
        return res.json({ ok: true, ...result });
      } catch (e) {
        next(e);
      }
    }
  );
};
