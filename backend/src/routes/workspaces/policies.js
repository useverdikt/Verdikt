"use strict";

const { run } = require("../../database");
const {
  nowIso,
  writeAudit,
  authMiddleware,
  requireNonViewer,
  requireWorkspaceMatch,
  getWorkspacePolicy,
  getBaselinePolicy,
  setBaselinePolicy,
  getOutboundWebhook,
  setOutboundWebhook,
  deleteOutboundWebhook
} = require("../deps");

module.exports = function registerRoutes(app) {
app.get("/api/workspaces/:workspaceId/policies", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const policy = await getWorkspacePolicy(req.params.workspaceId);
    return res.json({
      workspace_id: req.params.workspaceId,
      policies: {
        require_ai_eval: policy.require_ai_eval === 1,
        ai_missing_policy: policy.ai_missing_policy,
        gate_mode: policy.gate_mode === "strict" ? "strict" : "default",
        escalation_notify_email: policy.escalation_notify_email || null,
        escalation_sla_hours: Number(policy.escalation_sla_hours ?? 24)
      }
    });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/policies", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const current = await getWorkspacePolicy(req.params.workspaceId);
    const { require_ai_eval, ai_missing_policy, gate_mode, escalation_notify_email, escalation_sla_hours } =
      req.body || {};
    const nextRequireAi = typeof require_ai_eval === "boolean" ? (require_ai_eval ? 1 : 0) : current.require_ai_eval;
    const nextMissingPolicy =
      typeof ai_missing_policy === "string" && ["block_uncertified", "allow_without_ai"].includes(ai_missing_policy)
        ? ai_missing_policy
        : current.ai_missing_policy;
    const nextGateMode =
      gate_mode === "strict" || gate_mode === "default" ? gate_mode : current.gate_mode || "default";
    const nextNotifyEmail =
      escalation_notify_email === null || escalation_notify_email === ""
        ? null
        : typeof escalation_notify_email === "string"
          ? escalation_notify_email.trim().slice(0, 500) || null
          : current.escalation_notify_email;
    const nextSlaHours = Number.isFinite(Number(escalation_sla_hours))
      ? Math.max(1, Math.min(168, Number(escalation_sla_hours)))
      : Number(current.escalation_sla_hours ?? 24);

    await run(
      `UPDATE workspace_policies SET require_ai_eval = ?, ai_missing_policy = ?, gate_mode = ?,
       escalation_notify_email = ?, escalation_sla_hours = ?, updated_at = ? WHERE workspace_id = ?`,
      [
        nextRequireAi,
        nextMissingPolicy,
        nextGateMode,
        nextNotifyEmail,
        nextSlaHours,
        nowIso(),
        req.params.workspaceId
      ]
    );
    await writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "POLICY_UPDATED",
      actorType: "USER",
      actorName: req.auth?.email || "workspace_admin",
      details: {
        require_ai_eval: nextRequireAi === 1,
        ai_missing_policy: nextMissingPolicy,
        gate_mode: nextGateMode,
        escalation_notify_email: nextNotifyEmail,
        escalation_sla_hours: nextSlaHours
      }
    });
    return res.json({
      ok: true,
      policies: {
        require_ai_eval: nextRequireAi === 1,
        ai_missing_policy: nextMissingPolicy,
        gate_mode: nextGateMode,
        escalation_notify_email: nextNotifyEmail,
        escalation_sla_hours: nextSlaHours
      }
    });
  } catch (e) {
    next(e);
  }
});
app.get("/api/workspaces/:workspaceId/baseline-policy", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const policy = await getBaselinePolicy(req.params.workspaceId);
    return res.json(policy);
  } catch (e) {
    next(e);
  }
});

app.put("/api/workspaces/:workspaceId/baseline-policy", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
  const { strategy, window_n, pinned_release_id } = req.body || {};
  try {
    await setBaselinePolicy(req.params.workspaceId, { strategy, window_n, pinned_release_id });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const policy = await getBaselinePolicy(req.params.workspaceId);
  writeAudit({
    workspaceId: req.params.workspaceId,
    eventType: "BASELINE_POLICY_UPDATED",
    actorType: "USER",
    actorName: req.auth?.email || "user",
    details: { strategy, window_n, pinned_release_id }
  });
  return res.json(policy);
  } catch (e) {
    next(e);
  }
});

// ─── Outbound Webhook ─────────────────────────────────────────────────────────

app.get("/api/workspaces/:workspaceId/outbound-webhook", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const hook = await getOutboundWebhook(req.params.workspaceId);
    if (!hook) return res.status(404).json({ error: "no outbound webhook configured" });
    // Mask secret
    const safe = { ...hook, secret: hook.secret ? "***" : null };
    return res.json(safe);
  } catch (e) {
    next(e);
  }
});

app.put("/api/workspaces/:workspaceId/outbound-webhook", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const { url, secret, events } = req.body || {};
    if (!url || typeof url !== "string") return res.status(400).json({ error: "url is required" });
    let safeUrl;
    try {
      const { validateOutboundWebhookUrl } = require("../../lib/outboundUrl");
      safeUrl = await validateOutboundWebhookUrl(url);
    } catch (err) {
      return res.status(400).json({ error: err.message || "Invalid outbound webhook URL" });
    }
    await setOutboundWebhook(req.params.workspaceId, { url: safeUrl, secret, events });
    writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "OUTBOUND_WEBHOOK_CONFIGURED",
      actorType: "USER",
      actorName: req.auth?.email || "user",
      details: { url: safeUrl, events }
    });
    const hook = await getOutboundWebhook(req.params.workspaceId);
    return res.json({ ...hook, secret: hook?.secret ? "***" : null });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/workspaces/:workspaceId/outbound-webhook", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    await deleteOutboundWebhook(req.params.workspaceId);
    writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "OUTBOUND_WEBHOOK_REMOVED",
      actorType: "USER",
      actorName: req.auth?.email || "user",
      details: {}
    });
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
};
