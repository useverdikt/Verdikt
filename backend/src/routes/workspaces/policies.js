"use strict";

const { run } = require("../../database");
const {
  nowIso,
  writeAudit,
  authMiddleware,
  requireHumanSession,
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
        escalation_sla_hours: Number(policy.escalation_sla_hours ?? 24),
        public_cert_records: policy.public_cert_records !== false && policy.public_cert_records !== 0,
        show_signal_detail: policy.show_signal_detail !== false && policy.show_signal_detail !== 0,
        show_override_justification: policy.show_override_justification !== false && policy.show_override_justification !== 0,
        slack_webhook_url: policy.slack_webhook_url || null
      }
    });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/policies", authMiddleware, requireHumanSession, requireWorkspaceMatch, requireNonViewer, async (req, res, next) => {
  try {
    const current = await getWorkspacePolicy(req.params.workspaceId);
    const {
      require_ai_eval, ai_missing_policy, gate_mode, escalation_notify_email, escalation_sla_hours,
      public_cert_records, show_signal_detail, show_override_justification, slack_webhook_url
    } = req.body || {};
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
    const currentPublic = current.public_cert_records !== false && current.public_cert_records !== 0;
    const nextPublicCertRecords = typeof public_cert_records === "boolean" ? public_cert_records : currentPublic;
    const currentSignalDetail = current.show_signal_detail !== false && current.show_signal_detail !== 0;
    const nextShowSignalDetail = typeof show_signal_detail === "boolean" ? show_signal_detail : currentSignalDetail;
    const currentOverrideJust = current.show_override_justification !== false && current.show_override_justification !== 0;
    const nextShowOverrideJust = typeof show_override_justification === "boolean" ? show_override_justification : currentOverrideJust;
    const nextSlackUrl =
      slack_webhook_url === null || slack_webhook_url === ""
        ? null
        : typeof slack_webhook_url === "string"
          ? slack_webhook_url.trim().slice(0, 2000) || null
          : current.slack_webhook_url || null;

    await run(
      `UPDATE workspace_policies SET require_ai_eval = ?, ai_missing_policy = ?, gate_mode = ?,
       escalation_notify_email = ?, escalation_sla_hours = ?,
       public_cert_records = ?, show_signal_detail = ?, show_override_justification = ?,
       slack_webhook_url = ?, updated_at = ? WHERE workspace_id = ?`,
      [
        nextRequireAi,
        nextMissingPolicy,
        nextGateMode,
        nextNotifyEmail,
        nextSlaHours,
        nextPublicCertRecords,
        nextShowSignalDetail,
        nextShowOverrideJust,
        nextSlackUrl,
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
        escalation_sla_hours: nextSlaHours,
        public_cert_records: nextPublicCertRecords,
        show_signal_detail: nextShowSignalDetail,
        show_override_justification: nextShowOverrideJust,
        slack_webhook_url: nextSlackUrl ? "set" : null
      }
    });
    return res.json({
      ok: true,
      policies: {
        require_ai_eval: nextRequireAi === 1,
        ai_missing_policy: nextMissingPolicy,
        gate_mode: nextGateMode,
        escalation_notify_email: nextNotifyEmail,
        escalation_sla_hours: nextSlaHours,
        public_cert_records: nextPublicCertRecords,
        show_signal_detail: nextShowSignalDetail,
        show_override_justification: nextShowOverrideJust,
        slack_webhook_url: nextSlackUrl
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

app.put("/api/workspaces/:workspaceId/baseline-policy", authMiddleware, requireHumanSession, requireWorkspaceMatch, requireNonViewer, async (req, res, next) => {
  try {
  const { strategy, window_n, pinned_release_id } = req.body || {};
  try {
    await setBaselinePolicy(req.params.workspaceId, { strategy, window_n, pinned_release_id });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const policy = await getBaselinePolicy(req.params.workspaceId);
  await writeAudit({
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

app.put("/api/workspaces/:workspaceId/outbound-webhook", authMiddleware, requireHumanSession, requireWorkspaceMatch, requireNonViewer, async (req, res, next) => {
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
    await writeAudit({
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

app.delete("/api/workspaces/:workspaceId/outbound-webhook", authMiddleware, requireHumanSession, requireWorkspaceMatch, requireNonViewer, async (req, res, next) => {
  try {
    await deleteOutboundWebhook(req.params.workspaceId);
    await writeAudit({
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
