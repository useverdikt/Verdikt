"use strict";

const {
  authMiddleware,
  requireHumanSession,
  requireNonViewer,
  requireOrgAdmin,
  requireWorkspaceMatch
} = require("../../middleware/auth");
const { getUserRowForAuthById } = require("../../services/authUserLookup");
const {
  listWorkspaceMembersAndInvites,
  createWorkspaceInvite,
  updateMemberRole,
  removeMember,
  revokeInvite
} = require("../../services/workspaceMembers");

module.exports = function registerWorkspaceMemberRoutes(app) {
  app.get("/api/workspaces/:workspaceId/members", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
    try {
      const out = await listWorkspaceMembersAndInvites(req.params.workspaceId);
      return res.json({ workspace_id: req.params.workspaceId, ...out });
    } catch (e) {
      next(e);
    }
  });

  app.post(
    "/api/workspaces/:workspaceId/members/invite",
    authMiddleware,
    requireHumanSession,
    requireNonViewer,
    requireOrgAdmin,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const { email, role = "ai_product_lead" } = req.body || {};
        const actor = await getUserRowForAuthById(req.auth.sub);
        const out = await createWorkspaceInvite({
          workspaceId: req.params.workspaceId,
          email,
          role,
          invitedByUserId: req.auth.sub,
          inviterName: actor?.name || req.auth.email
        });
        if (!out.ok) {
          return res.status(out.statusCode || 400).json({ error: out.error });
        }
        return res.status(201).json({ ok: true, invite: out.invite });
      } catch (e) {
        next(e);
      }
    }
  );

  app.patch(
    "/api/workspaces/:workspaceId/members/:userId",
    authMiddleware,
    requireHumanSession,
    requireNonViewer,
    requireOrgAdmin,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const { role } = req.body || {};
        const out = await updateMemberRole({
          workspaceId: req.params.workspaceId,
          targetUserId: req.params.userId,
          role,
          actorEmail: req.auth.email
        });
        if (!out.ok) {
          return res.status(out.statusCode || 400).json({ error: out.error });
        }
        return res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    }
  );

  app.delete(
    "/api/workspaces/:workspaceId/members/:userId",
    authMiddleware,
    requireHumanSession,
    requireNonViewer,
    requireOrgAdmin,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const out = await removeMember({
          workspaceId: req.params.workspaceId,
          targetUserId: req.params.userId,
          actorUserId: req.auth.sub,
          actorEmail: req.auth.email
        });
        if (!out.ok) {
          return res.status(out.statusCode || 400).json({ error: out.error });
        }
        return res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    }
  );

  app.delete(
    "/api/workspaces/:workspaceId/members/invites/:inviteId",
    authMiddleware,
    requireHumanSession,
    requireNonViewer,
    requireOrgAdmin,
    requireWorkspaceMatch,
    async (req, res, next) => {
      try {
        const out = await revokeInvite({
          workspaceId: req.params.workspaceId,
          inviteId: req.params.inviteId,
          actorEmail: req.auth.email
        });
        if (!out.ok) {
          return res.status(out.statusCode || 400).json({ error: out.error });
        }
        return res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    }
  );
};
