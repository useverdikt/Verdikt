"use strict";

/**
 * sseManager.js
 * Server-Sent Events (SSE) manager for real-time collecting state updates.
 *
 * Pattern:
 *   1. Client requests a short-lived SSE token: POST /api/releases/:id/sse-token
 *   2. Client opens: GET /api/releases/:id/stream?token=<tok>
 *   3. Backend pushes events whenever signal ingests or verdict updates happen.
 *
 * In single-replica deployments, events are delivered through an in-memory map.
 * In multi-replica deployments, set REDIS_URL so events are published to a Redis
 * backplane and every replica forwards them to its local listeners.
 */

const crypto = require("crypto");
const { run, queryOne } = require("../database");
const { nowIso } = require("../lib/time");
const ssePubSub = require("./ssePubSub");

const TOKEN_TTL_MINUTES = 30;

// In-memory subscriber map: releaseId -> Set<{ res, ts }>
const subscribers = new Map();

/**
 * Issue a short-lived SSE stream token for a release.
 */
async function issueStreamToken(releaseId, workspaceId) {
  const token = crypto.randomBytes(24).toString("base64url");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

  await run(
    `
    INSERT INTO sse_tokens (token, workspace_id, release_id, expires_at, created_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT(token) DO NOTHING
  `,
    [token, workspaceId, releaseId, expiresAt, now]
  );

  try {
    await run("DELETE FROM sse_tokens WHERE expires_at < $1", [now]);
  } catch (_) {}

  return { token, expires_at: expiresAt };
}

/**
 * Validate an SSE token. Returns { valid, workspaceId, releaseId } or { valid: false }.
 */
async function validateStreamToken(token, releaseId) {
  if (!token) return { valid: false };
  const row = await queryOne("SELECT * FROM sse_tokens WHERE token = $1", [token]);
  if (!row) return { valid: false, reason: "unknown_token" };
  if (row.release_id && row.release_id !== releaseId) return { valid: false, reason: "release_mismatch" };
  if (Date.parse(row.expires_at) < Date.now()) return { valid: false, reason: "token_expired" };
  return { valid: true, workspaceId: row.workspace_id, releaseId: row.release_id || releaseId };
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastLocal(releaseId, eventName, data) {
  const subs = subscribers.get(releaseId);
  if (!subs || !subs.size) return;
  for (const { res } of [...subs]) {
    try {
      sseWrite(res, eventName, data);
    } catch (_) {}
  }
}

function broadcastVerdictAndCloseLocal(releaseId, verdict) {
  broadcastLocal(releaseId, "verdict", verdict);
  const subs = subscribers.get(releaseId);
  if (!subs) return;
  for (const { res } of [...subs]) {
    try {
      sseWrite(res, "stream_end", { reason: "verdict_issued" });
      res.end();
    } catch (_) {}
  }
  subscribers.delete(releaseId);
}

async function handleRemoteMessage(releaseId, eventName, data) {
  if (eventName === "verdict_and_close") {
    broadcastVerdictAndCloseLocal(releaseId, data);
    await ssePubSub.unsubscribe(releaseId);
    return;
  }
  broadcastLocal(releaseId, eventName, data);
}

/**
 * Attach an HTTP response to the SSE subscription for a release.
 * Handles heartbeat and client disconnect cleanup.
 */
async function attachStream(releaseId, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  sseWrite(res, "connected", { release_id: releaseId, ts: nowIso() });

  if (!subscribers.has(releaseId)) subscribers.set(releaseId, new Set());
  const entry = { res, ts: Date.now() };
  subscribers.get(releaseId).add(entry);

  // Subscribe this replica to the cross-process backplane for this release.
  if (ssePubSub.isEnabled() && subscribers.get(releaseId).size === 1) {
    await ssePubSub.subscribe(releaseId, (eventName, data) => {
      void handleRemoteMessage(releaseId, eventName, data);
    });
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch (_) {
      clearInterval(heartbeat);
    }
  }, 25_000);

  res.on("close", async () => {
    clearInterval(heartbeat);
    const subs = subscribers.get(releaseId);
    if (subs) {
      subs.delete(entry);
      if (!subs.size) {
        subscribers.delete(releaseId);
        await ssePubSub.unsubscribe(releaseId);
      }
    }
  });
}

/**
 * Broadcast an event to all listeners for a release. If a Redis backplane is
 * configured, the event is published there so every replica can forward it to
 * its local listeners. Otherwise, it is delivered to the local in-memory map only.
 */
function broadcastToRelease(releaseId, eventName, data) {
  if (ssePubSub.isEnabled()) {
    void ssePubSub.publish(releaseId, eventName, data);
    return;
  }
  broadcastLocal(releaseId, eventName, data);
}

/**
 * Broadcast the final verdict and close all listeners for a release.
 */
function broadcastVerdictAndClose(releaseId, verdict) {
  if (ssePubSub.isEnabled()) {
    void ssePubSub.publish(releaseId, "verdict_and_close", verdict);
    return;
  }
  broadcastVerdictAndCloseLocal(releaseId, verdict);
}

function activeSubscriberCount(releaseId) {
  return subscribers.get(releaseId)?.size ?? 0;
}

module.exports = {
  issueStreamToken,
  validateStreamToken,
  attachStream,
  broadcastToRelease,
  broadcastVerdictAndClose,
  activeSubscriberCount
};
