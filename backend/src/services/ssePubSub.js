"use strict";

/**
 * Redis pub/sub backplane for SSE updates across multiple API replicas.
 *
 * When REDIS_URL is set, every broadcast is published to a per-release channel
 * (`sse:{releaseId}`). Each API replica subscribes to the channels that have local
 * listeners and forwards messages to those listeners. Without REDIS_URL, SSE stays
 * in-process only (single-replica deployments).
 */

const Redis = require("ioredis");
const { REDIS_URL } = require("../config");

let publisher = null;
let subscriber = null;
const handlers = new Map();

function isEnabled() {
  return !!REDIS_URL;
}

function getPublisher() {
  if (!publisher) {
    publisher = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 50, 500)
    });
    publisher.on("error", () => {});
  }
  return publisher;
}

function getSubscriber() {
  if (!subscriber) {
    subscriber = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 50, 500)
    });
    subscriber.on("error", () => {});
    subscriber.on("message", (channel, message) => {
      const releaseId = channel.replace(/^sse:/, "");
      const handler = handlers.get(releaseId);
      if (!handler) return;
      try {
        const payload = JSON.parse(message);
        handler(payload.event, payload.data);
      } catch {
        // Ignore malformed cross-replica messages.
      }
    });
  }
  return subscriber;
}

async function publish(releaseId, event, data) {
  if (!isEnabled()) return;
  try {
    const client = getPublisher();
    await client.publish(`sse:${releaseId}`, JSON.stringify({ event, data }));
  } catch {
    // SSE is best-effort; a Redis outage must not block the API response.
  }
}

async function subscribe(releaseId, handler) {
  if (!isEnabled()) return;
  handlers.set(releaseId, handler);
  try {
    await getSubscriber().subscribe(`sse:${releaseId}`);
  } catch {
    handlers.delete(releaseId);
  }
}

async function unsubscribe(releaseId) {
  if (!isEnabled()) return;
  handlers.delete(releaseId);
  try {
    await getSubscriber().unsubscribe(`sse:${releaseId}`);
  } catch {
    // Best-effort cleanup.
  }
}

module.exports = { isEnabled, publish, subscribe, unsubscribe };
