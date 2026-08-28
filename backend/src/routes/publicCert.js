"use strict";

const { sendError } = require("../lib/apiError");

const { getPublicCertRecord, getPublicCertRecordByReleaseId } = require("../services/publicCertRecord");
const { listPublicCertKeys } = require("../services/certSigner");
const { getLatestPublicAnchor } = require("../services/auditAnchor");
const { normalizeWorkspaceSlug } = require("../lib/workspaceSlug");
const { queryOne } = require("../database");

module.exports = function registerRoutes(app) {
  app.get("/api/public/cert-keys", (_req, res) => {
    return res.json(listPublicCertKeys());
  });

  app.get("/api/public/audit-anchors/:workspaceSlug", async (req, res, next) => {
    try {
      const slug = normalizeWorkspaceSlug(req.params.workspaceSlug);
      if (!slug) return sendError(res, req, 404, "audit anchor not found");
      const policy = await queryOne(
        `SELECT workspace_id, public_slug FROM workspace_policies
          WHERE LOWER(public_slug) = LOWER($1) AND public_slug IS NOT NULL AND public_slug <> ''`,
        [slug]
      );
      if (!policy) return sendError(res, req, 404, "audit anchor not found");
      const anchor = await getLatestPublicAnchor(policy.workspace_id, {
        workspaceSlug: policy.public_slug || slug
      });
      if (!anchor) return sendError(res, req, 404, "audit anchor not found");
      return res.json(anchor);
    } catch (e) {
      next(e);
    }
  });

  /** Immutable permalink — register before the slug/version route. */
  app.get("/api/public/cert/id/:releaseId", async (req, res, next) => {
    try {
      const out = await getPublicCertRecordByReleaseId(req.params.releaseId);
      if (out.error) return sendError(res, req, out.status || 404, "certification record not found");
      return res.json(out.record);
    } catch (e) {
      next(e);
    }
  });

  /** Public certification record — no auth; gated by workspace public_cert_records policy. */
  app.get("/api/public/cert/:workspaceSlug/:version", async (req, res, next) => {
    try {
      const out = await getPublicCertRecord(req.params.workspaceSlug, req.params.version);
      if (out.error) return sendError(res, req, out.status || 404, "certification record not found");
      return res.json(out.record);
    } catch (e) {
      next(e);
    }
  });
};
