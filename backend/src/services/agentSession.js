"use strict";

const crypto = require("crypto");
const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");

const SESSION_HEADER = "x-verdikt-agent-session";
const SESSION_ID_RE = /^as_[a-zA-Z0-9_-]{8,80}$/;

function normalizeAgentSessionId(raw) {
  const s = String(raw || "").trim();
  if (!s || !SESSION_ID_RE.test(s)) return null;
  return s;
}

function generateAgentSessionId() {
  return `as_${crypto.randomUUID().replace(/-/g, "")}`;
}

function readSessionHeader(req) {
  const h = req.headers[SESSION_HEADER] || req.headers["X-Verdikt-Agent-Session"];
  return normalizeAgentSessionId(Array.isArray(h) ? h[0] : h);
}

/**
 * Upsert session row and return id (null if header missing/invalid).
 */
async function touchAgentSession({ sessionId, workspaceId, apiKeyId = null, label = null, metadata = null }) {
  const id = normalizeAgentSessionId(sessionId);
  if (!id || !workspaceId) return null;
  const now = nowIso();
  const metaJson = metadata && typeof metadata === "object" ? JSON.stringify(metadata) : null;
  const existing = await queryOne("SELECT id FROM agent_sessions WHERE id = $1", [id]);
  if (existing) {
    await run(
      `UPDATE agent_sessions SET last_seen_at = $1, api_key_id = COALESCE($2, api_key_id), label = COALESCE($3, label)
       WHERE id = $4 AND workspace_id = $5`,
      [now, apiKeyId, label, id, workspaceId]
    );
    return id;
  }
  await run(
    `INSERT INTO agent_sessions (id, workspace_id, api_key_id, label, started_at, last_seen_at, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, workspaceId, apiKeyId, label, now, now, metaJson]
  );
  return id;
}

async function resolveAgentSessionForApiKey(req, keyRow) {
  const sessionId = readSessionHeader(req);
  if (!sessionId) return null;
  const labelHeader = req.headers["x-verdikt-agent-label"] || req.headers["X-Verdikt-Agent-Label"];
  const label =
    typeof labelHeader === "string" && labelHeader.trim()
      ? String(labelHeader).trim().slice(0, 120)
      : null;
  return touchAgentSession({
    sessionId,
    workspaceId: keyRow.workspace_id,
    apiKeyId: keyRow.id,
    label
  });
}

async function getAgentSessionAuditTrail(workspaceId, sessionId, { limit = 100 } = {}) {
  const id = normalizeAgentSessionId(sessionId);
  if (!id) return null;
  const session = await queryOne("SELECT * FROM agent_sessions WHERE id = $1 AND workspace_id = $2", [id, workspaceId]);
  if (!session) return null;
  const cap = Math.min(200, Math.max(1, limit));
  const { queryAll } = require("../database");
  const events = await queryAll(
    `SELECT id, release_id, event_type, actor_type, actor_name, details_json, created_at, agent_session_id
     FROM audit_events
     WHERE workspace_id = $1 AND agent_session_id = $2
     ORDER BY id ASC
     LIMIT $3`,
    [workspaceId, id, cap]
  );
  return {
    session: {
      id: session.id,
      workspace_id: session.workspace_id,
      api_key_id: session.api_key_id,
      label: session.label,
      started_at: session.started_at,
      last_seen_at: session.last_seen_at,
      metadata: session.metadata_json ? JSON.parse(session.metadata_json) : null
    },
    events: events.map((e) => ({
      id: e.id,
      release_id: e.release_id,
      event_type: e.event_type,
      actor_type: e.actor_type,
      actor_name: e.actor_name,
      created_at: e.created_at,
      details: JSON.parse(e.details_json || "{}")
    })),
    event_count: events.length
  };
}

module.exports = {
  SESSION_HEADER,
  SESSION_ID_RE,
  normalizeAgentSessionId,
  generateAgentSessionId,
  readSessionHeader,
  touchAgentSession,
  resolveAgentSessionForApiKey,
  getAgentSessionAuditTrail
};
