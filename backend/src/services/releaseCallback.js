"use strict";

const { validateOutboundWebhookUrl } = require("../lib/outboundUrl");
const { nowIso } = require("../lib/time");

function buildReleaseCallbackPayload(release, verdictIntelligence, gateExtras = {}, failedSignals = [], certification = null) {
  const signals = failedSignals.length ? failedSignals : (verdictIntelligence?.failed_signals ?? []);
  return {
    event: "verdikt.verdict",
    release_id: release.id,
    workspace_id: release.workspace_id,
    version: release.version,
    status: release.status,
    verdict_issued_at: release.verdict_issued_at,
    failed_signals: signals,
    certification: certification || null,
    gate: {
      certified: ["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"].includes(release.status),
      can_merge: release.status === "CERTIFIED",
      blocking_signals: signals.map((f) => f.signal_id).filter(Boolean),
      ...gateExtras
    },
    sent_at: nowIso()
  };
}

async function deliverReleaseCallback(release, verdictIntelligence, gateExtras = {}, failedSignals = [], certification = null) {
  const callbackUrl = String(release.callback_url || "").trim();
  if (!callbackUrl) return { delivered: false, reason: "no_callback_url" };

  let safeUrl;
  try {
    safeUrl = await validateOutboundWebhookUrl(callbackUrl);
  } catch (e) {
    console.error("[release_callback] blocked URL:", release.id, e?.message);
    return { delivered: false, reason: e?.message || "invalid_url" };
  }

  const body = JSON.stringify(buildReleaseCallbackPayload(release, verdictIntelligence, gateExtras, failedSignals, certification));

  try {
    const res = await fetch(safeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Verdikt-Callback/1.0"
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      console.error("[release_callback] non-2xx:", release.id, res.status);
      return { delivered: false, reason: `http_${res.status}` };
    }
    return { delivered: true, status: res.status };
  } catch (err) {
    console.error("[release_callback] delivery error:", release.id, err?.message);
    return { delivered: false, reason: err?.message || "delivery_failed" };
  }
}

module.exports = { buildReleaseCallbackPayload, deliverReleaseCallback };
