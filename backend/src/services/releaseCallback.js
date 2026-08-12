"use strict";

const { postJsonWithTimeout } = require("../lib/outboundHttp");
const { validateOutboundWebhookUrl } = require("../lib/outboundUrl");
const { nowIso } = require("../lib/time");
const { recordLegacyEffectObservation } = require("./outboundEffectLegacyObservation");

const RELEASE_CALLBACK_TIMEOUT_MS = 15_000;

function buildReleaseCallbackPayload(release, verdictIntelligence, gateExtras = {}, failedSignals = [], certification = null) {
  const signals = failedSignals.length ? failedSignals : (verdictIntelligence?.failed_signals ?? []);
  const certLike = ["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"].includes(release.status);
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
      certified: certLike,
      can_merge: certLike,
      blocking_signals: signals.map((f) => f.signal_id).filter(Boolean),
      ...gateExtras
    },
    sent_at: nowIso()
  };
}

async function deliverReleaseCallback(release, verdictIntelligence, gateExtras = {}, failedSignals = [], certification = null) {
  const callbackUrl = String(release.callback_url || "").trim();
  if (!callbackUrl) return { delivered: false, reason: "no_callback_url" };
  const payload = buildReleaseCallbackPayload(
    release,
    verdictIntelligence,
    gateExtras,
    failedSignals,
    certification
  );
  const observedSignals = payload.failed_signals;

  let safeUrl;
  try {
    safeUrl = await validateOutboundWebhookUrl(callbackUrl);
  } catch (e) {
    console.error("[release_callback] blocked URL:", release.id, e?.message);
    await recordLegacyEffectObservation({
      release,
      effectType: "release_callback",
      failedSignals: observedSignals,
      payload,
      outcome: "blocked",
      errorCode: "invalid_url"
    });
    return { delivered: false, reason: e?.message || "invalid_url" };
  }

  const body = JSON.stringify(payload);

  try {
    const res = await postJsonWithTimeout(safeUrl, body, {
      headers: {
        "User-Agent": "Verdikt-Callback/1.0"
      },
      redirect: "error",
      timeoutMs: RELEASE_CALLBACK_TIMEOUT_MS
    });
    if (!res.ok) {
      console.error("[release_callback] non-2xx:", release.id, res.status);
      await recordLegacyEffectObservation({
        release,
        effectType: "release_callback",
        failedSignals: observedSignals,
        payload,
        outcome: "failed",
        responseStatus: res.status,
        errorCode: `http_${res.status}`
      });
      return { delivered: false, reason: `http_${res.status}` };
    }
    await recordLegacyEffectObservation({
      release,
      effectType: "release_callback",
      failedSignals: observedSignals,
      payload,
      outcome: "succeeded",
      responseStatus: res.status
    });
    return { delivered: true, status: res.status };
  } catch (err) {
    console.error("[release_callback] delivery error:", release.id, err?.message);
    await recordLegacyEffectObservation({
      release,
      effectType: "release_callback",
      failedSignals: observedSignals,
      payload,
      outcome: "failed",
      errorCode: "delivery_failed"
    });
    return { delivered: false, reason: err?.message || "delivery_failed" };
  }
}

module.exports = {
  RELEASE_CALLBACK_TIMEOUT_MS,
  buildReleaseCallbackPayload,
  deliverReleaseCallback
};
