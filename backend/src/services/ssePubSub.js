"use strict";

/**
 * PostgreSQL LISTEN/NOTIFY backplane for SSE updates across multiple API replicas.
 *
 * Uses a single channel (`sse_events`) and JSON payloads containing the target
 * releaseId, event name, and data. Works with any PostgreSQL provider, including
 * Supabase, without requiring Redis.
 */

const { Client } = require("pg");
const { log } = require("../lib/observability");

const CHANNEL = "sse_events";

let listenerClient = null;
let connecting = false;
const handlers = new Map();

function isEnabled() {
  return true;
}

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the SSE cross-replica backplane");
  return url;
}

async function connectListener() {
  if (listenerClient || connecting) return;
  connecting = true;
  try {
    const client = new Client({ connectionString: getDatabaseUrl() });
    client.on("notification", (msg) => {
      try {
        const payload = JSON.parse(msg.payload);
        const handler = handlers.get(payload.releaseId);
        if (handler) handler(payload.event, payload.data);
      } catch {
        // Ignore malformed cross-replica messages.
      }
    });
    client.on("error", (err) => {
      log("error", "sse_pg_notify_listener_error", { error: err?.message });
      listenerClient = null;
      setTimeout(() => void connectListener().catch(() => {}), 5000);
    });
    client.on("end", () => {
      listenerClient = null;
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listenerClient = client;
  } finally {
    connecting = false;
  }
}

async function publish(releaseId, event, data) {
  const { query } = require("../database");
  const payload = JSON.stringify({ releaseId, event, data }).replace(/'/g, "''");
  await query(`NOTIFY ${CHANNEL}, '${payload}'`);
}

async function subscribe(releaseId, handler) {
  handlers.set(releaseId, handler);
  try {
    await connectListener();
  } catch (err) {
    handlers.delete(releaseId);
    throw err;
  }
}

async function unsubscribe(releaseId) {
  handlers.delete(releaseId);
}

async function closeListener() {
  if (listenerClient) {
    const client = listenerClient;
    listenerClient = null;
    try {
      await client.query(`UNLISTEN ${CHANNEL}`);
      await client.end();
    } catch {
      // Best-effort cleanup.
    }
  }
}

module.exports = { isEnabled, publish, subscribe, unsubscribe, closeListener };
