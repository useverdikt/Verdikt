"use strict";

const { nowIso } = require("../lib/time");
const { writeAudit } = require("./audit");

const PENDING = "pending_human_review";
const RESOLVED = "resolved";

/**
 * Resolve the release's pending escalation once the release is cert-like, so
 * the inbox and SLA sweep never chase a release that no longer needs a human.
 * Must run in the transaction that commits the cert-like status.
 */
async function resolvePendingEscalationsForRelease(tx, { workspaceId, releaseId, releaseStatus, trigger }) {
  const ts = nowIso();
  const resolvedBy = `system:${trigger}`;
  const resolved = await tx.queryAll(
    `UPDATE escalation_requests
        SET state = $1, acknowledged_at = $2, acknowledged_by = $3, updated_at = $2
      WHERE release_id = $4 AND state = $5
      RETURNING id`,
    [RESOLVED, ts, resolvedBy, releaseId, PENDING]
  );
  for (const row of resolved) {
    await writeAudit({
      workspaceId,
      releaseId,
      eventType: "ESCALATION_AUTO_RESOLVED",
      actorType: "SYSTEM",
      actorName: resolvedBy,
      details: { escalation_id: row.id, release_status: releaseStatus, trigger },
      tx
    });
  }
  return resolved.map((row) => row.id);
}

module.exports = { resolvePendingEscalationsForRelease, PENDING, RESOLVED };
