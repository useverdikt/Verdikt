"use strict";

/**
 * outboundWebhook.js
 * Delivers signed verdict events to configured CI/CD pipeline endpoints.
 * Called after CERTIFIED or UNCERTIFIED verdict is issued.
 */

const crypto = require("crypto");
const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");
const { encryptToken, decryptToken, looksEncrypted, migratePlaintextFieldIfNeeded } = require("../lib/encryption");

async function getOutboundWebhook(workspaceId) {
  const row = await queryOne("SELECT * FROM outbound_webhooks WHERE workspace_id = ? AND enabled = 1", [workspaceId]);
  if (!row) return null;
  if (!row.secret) return row;
  let sec = row.secret;
  if (!looksEncrypted(sec)) {
    const mig = migratePlaintextFieldIfNeeded(sec, "outbound_webhooks.secret");
    if (mig !== sec) {
      await run("UPDATE outbound_webhooks SET secret = ?, updated_at = ? WHERE workspace_id = ?", [
        mig,
        nowIso(),
        workspaceId
      ]);
      sec = mig;
    }
  }
  return { ...row, secret: decryptToken(sec) };
}

async function setOutboundWebhook(workspaceId, { url, secret, events }) {
  const id = `owh_${workspaceId}`;
  const now = nowIso();
  const eventsStr = Array.isArray(events) ? events.join(",") : events || "CERTIFIED,UNCERTIFIED,CERTIFIED_WITH_OVERRIDE";
  const secretEnc = secret ? encryptToken(secret) : null;
  await run(
    `
    INSERT INTO outbound_webhooks (id, workspace_id, url, secret, events, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      url        = excluded.url,
      secret     = excluded.secret,
      events     = excluded.events,
      enabled    = 1,
      updated_at = excluded.updated_at
  `,
    [id, workspaceId, url, secretEnc, eventsStr, now, now]
  );
}

async function deleteOutboundWebhook(workspaceId) {
  await run("UPDATE outbound_webhooks SET enabled = 0, updated_at = ? WHERE workspace_id = ?", [nowIso(), workspaceId]);
}

function buildVerdictPayload(release, eventType, verdictIntelligence, sigRow) {
  return {
    event: eventType,
    release_id: release.id,
    workspace_id: release.workspace_id,
    version: release.version,
    release_type: release.release_type,
    environment: release.environment || null,
    status: release.status,
    verdict_issued_at: release.verdict_issued_at,
    failed_signals: verdictIntelligence?.failed_signals ?? [],
    cert_signature: sigRow
      ? { payload_hash: sigRow.payload_hash, signature: sigRow.signature, signed_at: sigRow.signed_at, algorithm: sigRow.algorithm }
      : null,
    sent_at: nowIso()
  };
}

function signOutboundPayload(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function deliverVerdictWebhook(release, verdictIntelligence, certSigRow) {
  const webhook = await getOutboundWebhook(release.workspace_id);
  if (!webhook) return;

  const eventType = release.status;
  const subscribedEvents = (webhook.events || "").split(",").map((e) => e.trim());
  if (!subscribedEvents.includes(eventType)) return;

  const payload = buildVerdictPayload(release, eventType, verdictIntelligence, certSigRow);
  const bodyStr = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "X-Verdikt-Event": eventType,
    "X-Verdikt-Release-Id": release.id,
    "X-Verdikt-Delivery": crypto.randomBytes(8).toString("hex")
  };
  if (webhook.secret) {
    headers["X-Verdikt-Signature"] = `sha256=${signOutboundPayload(bodyStr, webhook.secret)}`;
  }

  const deliveredAt = nowIso();
  let responseStatus = null;
  let errorMessage = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(webhook.url, { method: "POST", headers, body: bodyStr, signal: controller.signal });
    clearTimeout(timeout);
    responseStatus = res.status;
    if (!res.ok) {
      errorMessage = `Non-OK response: ${res.status}`;
    }
  } catch (err) {
    errorMessage = String(err?.message || err);
    console.error(`[outbound_webhook] delivery failed for ${release.id}:`, errorMessage);
  }

  await run(
    `
    INSERT INTO outbound_webhook_deliveries
      (webhook_id, release_id, event_type, payload_json, response_status, error_message, delivered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    [webhook.id, release.id, eventType, bodyStr, responseStatus, errorMessage, deliveredAt]
  );
}

module.exports = { getOutboundWebhook, setOutboundWebhook, deleteOutboundWebhook, deliverVerdictWebhook };
