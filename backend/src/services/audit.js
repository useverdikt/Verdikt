"use strict";

const { run } = require("../database");
const { nowIso } = require("../lib/time");
const { computeAuditChainFields } = require("./auditIntegrity");
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
  const detailsJson = JSON.stringify(details);

  const draftRow = {
    workspace_id: workspaceId,
    release_id: releaseId,
    event_type: eventType,
    actor_type: actorType,
    actor_name: actorName,
    details_json: detailsJson,
    created_at: createdAt
  };

  let prevHash = null;
  let rowHash = null;
  try {
    ({ prev_hash: prevHash, row_hash: rowHash } = await computeAuditChainFields(workspaceId, draftRow));
  } catch {
    /* non-fatal — insert without chain if compute fails */
  }

  await run(
    `INSERT INTO audit_events
       (workspace_id, release_id, event_type, actor_type, actor_name, details_json, created_at, agent_session_id, prev_hash, row_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      workspaceId,
      releaseId,
      eventType,
      actorType,
      actorName,
      detailsJson,
      createdAt,
      sessionId || null,
      prevHash,
      rowHash
    ]
  );
}

module.exports = { writeAudit, auditActorFromAuth };
