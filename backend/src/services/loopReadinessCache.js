"use strict";

const { computeWorkspaceLoopReadiness } = require("./loopReadinessStats");

const TTL_MS = 60_000;
/** @type {Map<string, { expiresAt: number, payload: object }>} */
const cache = new Map();

function invalidateLoopReadinessCache(workspaceId) {
  if (workspaceId) cache.delete(String(workspaceId));
  else cache.clear();
}

async function getWorkspaceLoopReadinessCached(workspaceId, nowMs = Date.now()) {
  const key = String(workspaceId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > nowMs) {
    return { ...hit.payload, cached: true, cached_at: new Date(hit.expiresAt - TTL_MS).toISOString() };
  }
  const payload = await computeWorkspaceLoopReadiness(workspaceId, nowMs);
  cache.set(key, { expiresAt: nowMs + TTL_MS, payload });
  return payload;
}

module.exports = { getWorkspaceLoopReadinessCached, invalidateLoopReadinessCache };
