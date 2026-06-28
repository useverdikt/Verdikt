"use strict";

const { run, transaction } = require("../database");
const { nowIso } = require("../lib/time");
const auditIntegrity = require("./auditIntegrity");
const { getAgentSessionIdFromContext } = require("../lib/auditContext");

class AuditChainComputeError extends Error {
  constructor(cause) {
    const message =
      cause instanceof Error ? cause.message : String(cause || "unknown error");
    super(`Audit chain computation failed: ${message}`);
    this.name = "AuditChainComputeError";
    this.cause = cause instanceof Error ? cause : undefined;
  }
}

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

  // The SELECT FOR UPDATE in computeAuditChainFields and the INSERT are wrapped
  // in a single transaction so no concurrent writer can interleave between the
  // chain-tip read and the new row being written.
  try {
    await transaction(async (tx) => {
      let prevHash;
      let rowHash;
      try {
        ({ prev_hash: prevHash, row_hash: rowHash } = await auditIntegrity.computeAuditChainFields(
          workspaceId,
          draftRow,
          tx
        ));
      } catch (err) {
        throw new AuditChainComputeError(err);
      }

      if (prevHash == null || rowHash == null) {
        throw new AuditChainComputeError(new Error("missing prev_hash or row_hash"));
      }

      await tx.run(
        `INSERT INTO audit_events
           (workspace_id, release_id, event_type, actor_type, actor_name, details_json, created_at, agent_session_id, prev_hash, row_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
    });
  } catch (err) {
    if (err instanceof AuditChainComputeError) throw err;
    throw new AuditChainComputeError(err);
  }
}

module.exports = { writeAudit, auditActorFromAuth, AuditChainComputeError };
