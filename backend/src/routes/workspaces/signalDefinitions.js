"use strict";

const {
  writeAudit,
  authMiddleware,
  requireNonViewer,
  requireWorkspaceMatch
} = require("../deps");
const {
  getWorkspaceSignalCatalog,
  createWorkspaceDefinition,
  adoptLibrarySignal,
  deleteWorkspaceDefinition,
  getWorkspaceDefinition
} = require("../../services/signalDefinitions");

module.exports = function registerRoutes(app) {
  app.get(
    "/api/workspaces/:workspaceId/signal-definitions",
    authMiddleware,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const catalog = await getWorkspaceSignalCatalog(req.params.workspaceId);
        return res.json(catalog);
      } catch (e) {
        next(e);
      }
    }
  );

  app.post(
    "/api/workspaces/:workspaceId/signal-definitions",
    authMiddleware,
    requireNonViewer,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const body = req.body || {};
        const def = await createWorkspaceDefinition(req.params.workspaceId, body);
        await writeAudit({
          workspaceId: req.params.workspaceId,
          eventType: "SIGNAL_DEFINITION_CREATED",
          actorType: "USER",
          actorName: "workspace_admin",
          details: { signal_id: def.signal_id, from_library: def.from_library }
        });
        const catalog = await getWorkspaceSignalCatalog(req.params.workspaceId);
        return res.status(201).json({ definition: def, ...catalog });
      } catch (e) {
        if (String(e.message || "").includes("signal_id")) {
          return res.status(400).json({ error: e.message });
        }
        next(e);
      }
    }
  );

  app.post(
    "/api/workspaces/:workspaceId/signal-definitions/adopt",
    authMiddleware,
    requireNonViewer,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const { signal_id: signalId, threshold, required_for_certification } = req.body || {};
        if (!signalId) return res.status(400).json({ error: "signal_id is required" });
        const def = await adoptLibrarySignal(req.params.workspaceId, signalId, {
          threshold,
          required_for_certification
        });
        await writeAudit({
          workspaceId: req.params.workspaceId,
          eventType: "SIGNAL_DEFINITION_ADOPTED",
          actorType: "USER",
          actorName: "workspace_admin",
          details: { signal_id: def.signal_id }
        });
        const catalog = await getWorkspaceSignalCatalog(req.params.workspaceId);
        return res.json({ definition: def, ...catalog });
      } catch (e) {
        if (String(e.message || "").includes("not found")) {
          return res.status(404).json({ error: e.message });
        }
        next(e);
      }
    }
  );

  app.delete(
    "/api/workspaces/:workspaceId/signal-definitions/:signalId",
    authMiddleware,
    requireNonViewer,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const existing = await getWorkspaceDefinition(req.params.workspaceId, req.params.signalId);
        if (!existing) return res.status(404).json({ error: "signal definition not found" });
        await deleteWorkspaceDefinition(req.params.workspaceId, req.params.signalId);
        await writeAudit({
          workspaceId: req.params.workspaceId,
          eventType: "SIGNAL_DEFINITION_DELETED",
          actorType: "USER",
          actorName: "workspace_admin",
          details: { signal_id: req.params.signalId }
        });
        const catalog = await getWorkspaceSignalCatalog(req.params.workspaceId);
        return res.json(catalog);
      } catch (e) {
        next(e);
      }
    }
  );
};
