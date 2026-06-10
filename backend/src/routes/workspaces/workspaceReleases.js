"use strict";

const { run, queryOne, queryAll } = require("../../database");
const { validateOutboundWebhookUrl } = require("../../lib/outboundUrl");
const {
  nowIso,
  toIsoPlusMinutes,
  writeAudit,
  authMiddleware,
  requireNonViewer,
  requireWorkspaceMatch,
  verifyAuditIntegrity,
  ALLOWED_RELEASE_TYPES,
  DEFAULT_COLLECTION_WINDOW_MINUTES
} = require("../deps");

module.exports = function registerRoutes(app) {
app.get("/api/workspaces/:workspaceId/releases", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const ws = req.params.workspaceId;
    const countRow = await queryOne("SELECT COUNT(*) AS c FROM releases WHERE workspace_id = ?", [ws]);
    const total_count = Number(countRow?.c ?? 0);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
    const before = typeof req.query.before === "string" && req.query.before.trim() ? req.query.before.trim() : null;
    const rows = before
      ? await queryAll(
          `SELECT id, workspace_id, version, release_type, environment, status, created_at, updated_at, release_ref, trigger_source, collection_deadline, verdict_issued_at
           FROM releases WHERE workspace_id = ? AND created_at::timestamptz < ?::timestamptz
           ORDER BY created_at::timestamptz DESC LIMIT ?`,
          [ws, before, limit]
        )
      : await queryAll(
          `SELECT id, workspace_id, version, release_type, environment, status, created_at, updated_at, release_ref, trigger_source, collection_deadline, verdict_issued_at
           FROM releases WHERE workspace_id = ? ORDER BY created_at::timestamptz DESC LIMIT ?`,
          [ws, limit]
        );
    const last = rows[rows.length - 1];
    const next_before = rows.length === limit && last ? last.created_at : null;
    return res.json({
      workspace_id: ws,
      total_count,
      limit,
      next_before,
      has_more: !!next_before,
      releases: rows
    });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/releases", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const {
      version,
      release_type = "model_update",
      ai_context = {},
      commit_sha = null,
      pr_number = null,
      callback_url = null
    } = req.body || {};
    if (!version) return res.status(400).json({ error: "version is required" });
    if (typeof ai_context !== "object" || Array.isArray(ai_context)) {
      return res.status(400).json({ error: "ai_context must be an object" });
    }
    if (!ALLOWED_RELEASE_TYPES.has(release_type)) {
      return res.status(400).json({
        error: "release_type must be one of: prompt_update, model_patch, safety_patch, policy_change, model_update"
      });
    }

    let normalizedCallbackUrl = null;
    if (callback_url != null && String(callback_url).trim()) {
      try {
        normalizedCallbackUrl = await validateOutboundWebhookUrl(String(callback_url).trim());
      } catch (e) {
        return res.status(400).json({ error: `callback_url: ${e.message || "invalid"}` });
      }
    }

    const releaseId = `rel_${Date.now()}`;
    const now = nowIso();
    const deadline = toIsoPlusMinutes(DEFAULT_COLLECTION_WINDOW_MINUTES);
    const environment = "pre-prod";
    const triggerSource = req.auth?.authType === "api_key" ? "agent" : "manual";
    const actorType = req.auth?.authType === "api_key" ? "AGENT" : "USER";
    const actorName =
      req.auth?.authType === "api_key"
        ? req.auth.apiKeyName || "agent_runtime"
        : req.auth.email || "release_owner";

    await run(
      `INSERT INTO releases (
      id, workspace_id, version, release_type, environment, status, created_at, updated_at,
      release_ref, trigger_source, mappings_json, collection_deadline, verdict_issued_at, ai_context_json, commit_sha, pr_number, callback_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        releaseId,
        req.params.workspaceId,
        version,
        release_type,
        environment,
        "COLLECTING",
        now,
        now,
        version,
        triggerSource,
        "{}",
        deadline,
        null,
        JSON.stringify(ai_context || {}),
        commit_sha || null,
        pr_number || null,
        normalizedCallbackUrl
      ]
    );

    await writeAudit({
      workspaceId: req.params.workspaceId,
      releaseId,
      eventType: "RELEASE_CREATED",
      actorType,
      actorName,
      details: {
        version,
        release_type,
        environment,
        ai_context,
        commit_sha: commit_sha || null,
        pr_number: pr_number || null,
        callback_url: normalizedCallbackUrl,
        trigger_source: triggerSource
      }
    });

    return res.status(201).json({
      id: releaseId,
      workspace_id: req.params.workspaceId,
      version,
      release_type,
      environment,
      commit_sha: commit_sha || null,
      pr_number: pr_number || null,
      status: "COLLECTING",
      collection_deadline: deadline,
      callback_url: normalizedCallbackUrl,
      trigger_source: triggerSource
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/audit", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const raw = await queryAll(
      "SELECT event_type, actor_type, actor_name, release_id, details_json, created_at FROM audit_events WHERE workspace_id = ? ORDER BY id DESC LIMIT 200",
      [req.params.workspaceId]
    );
    const rows = raw.map((e) => ({ ...e, details: JSON.parse(e.details_json || "{}") }));
    return res.json({ workspace_id: req.params.workspaceId, events: rows });
  } catch (e) {
    next(e);
  }
});
// ─── Audit Integrity ──────────────────────────────────────────────────────────

/** Authenticated: verify audit log integrity for a workspace. */
app.get("/api/workspaces/:workspaceId/audit/integrity", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const result = await verifyAuditIntegrity(req.params.workspaceId);
    return res.json({ workspace_id: req.params.workspaceId, ...result });
  } catch (e) {
    next(e);
  }
});
};
