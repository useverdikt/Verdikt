"use strict";

const { transaction } = require("../database");
const { getAgentSessionIdFromContext } = require("../lib/auditContext");
const { inc } = require("../lib/observability");
const { writeAudit } = require("./audit");

const GATE_AUDIT_HEARTBEAT_MS = 5 * 60 * 1000;

async function writeGateAuditIfNeeded({
  workspaceId,
  releaseId,
  actorType,
  actorName,
  details,
  heartbeatMs = GATE_AUDIT_HEARTBEAT_MS,
  nowMs = Date.now()
}) {
  const agentSessionId = getAgentSessionIdFromContext();
  const detailsJson = JSON.stringify(details || {});
  const boundedHeartbeatMs = Math.max(1, Number(heartbeatMs) || GATE_AUDIT_HEARTBEAT_MS);

  return transaction(async (tx) => {
    // Serialize compare-and-append with every other audit write in this
    // workspace. This prevents replicas from both writing the same poll.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [workspaceId]);

    const latest = await tx.queryOne(
      `SELECT details_json, created_at
         FROM audit_events
        WHERE workspace_id = $1
          AND release_id IS NOT DISTINCT FROM $2
          AND event_type = 'RELEASE_GATE_CHECKED'
          AND actor_type = $3
          AND actor_name = $4
          AND agent_session_id IS NOT DISTINCT FROM $5
        ORDER BY id DESC
        LIMIT 1`,
      [workspaceId, releaseId, actorType, actorName, agentSessionId]
    );

    if (latest?.details_json === detailsJson) {
      const latestMs = Date.parse(latest.created_at || "");
      const elapsedMs = Number.isFinite(latestMs)
        ? Math.max(0, Number(nowMs) - latestMs)
        : boundedHeartbeatMs;
      if (elapsedMs < boundedHeartbeatMs) {
        inc("gate_audit_coalesced");
        return { written: false, reason: "unchanged_within_heartbeat" };
      }
    }

    const reason = !latest
      ? "first_result"
      : latest.details_json !== detailsJson
        ? "result_changed"
        : "heartbeat_elapsed";
    await writeAudit({
      workspaceId,
      releaseId,
      eventType: "RELEASE_GATE_CHECKED",
      actorType,
      actorName,
      details,
      agentSessionId,
      tx
    });
    inc(`gate_audit_written_${reason}`);
    return { written: true, reason };
  });
}

module.exports = { GATE_AUDIT_HEARTBEAT_MS, writeGateAuditIfNeeded };
