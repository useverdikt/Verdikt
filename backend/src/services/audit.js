"use strict";

const { run } = require("../database");
const { nowIso } = require("../lib/time");
const { stampAuditRowHash } = require("./auditIntegrity");
const { getAgentSessionIdFromContext } = require("../lib/auditContext");

function auditActorFromAuth(auth) {
  if (auth?.authType === "api_key") {
    return {
      actorType: "AGENT",
      actorName: auth.apiKeyName || "agent_runtime",
      api_key_id: auth.apiKeyId || null
    };
  }
  return {
    actorType: "USER",
    actorName: auth?.email || "user",
    api_key_id: null
  };
}

async function writeAudit({
  workspaceId,
  releaseId = null,
  eventType,
  actorType,
  actorName,
  details = {},
  agentSessionId = undefined
}) {
  const createdAt = nowIso();
  const sessionId =
    agentSessionId !== undefined ? agentSessionId : getAgentSessionIdFromContext();
  const ins = await run(
    `INSERT INTO audit_events (workspace_id, release_id, event_type, actor_type, actor_name, details_json, created_at, agent_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      workspaceId,
      releaseId,
      eventType,
      actorType,
      actorName,
      JSON.stringify(details),
      createdAt,
      sessionId || null
    ]
  );
  const rowId = ins.lastInsertRowid;
  if (rowId != null) {
    try {
      await stampAuditRowHash(rowId);
    } catch {
      /* non-fatal */
    }
  }
}

module.exports = { writeAudit, auditActorFromAuth };
