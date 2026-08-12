"use strict";

const { transaction, queryOne, run } = require("../database");

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const MAX_LEASE_MS = 60 * 60 * 1000;

function boundedPositiveInt(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

async function claimDueEscalations({
  limit,
  workerId,
  leaseMs = DEFAULT_LEASE_MS,
  workspaceId = null,
  transactionFn = transaction
}) {
  const batchLimit = boundedPositiveInt(limit, 100, 500);
  const boundedLeaseMs = boundedPositiveInt(leaseMs, DEFAULT_LEASE_MS, MAX_LEASE_MS);
  const owner = String(workerId || "").trim();
  if (!owner) throw new Error("escalation SLA sweep workerId is required");
  const workspaceScope = String(workspaceId || "").trim() || null;

  return transactionFn(async (tx) => {
    await tx.run(
      `DELETE FROM escalation_sla_sweep_claims c
        USING escalation_requests e
        WHERE c.escalation_id = e.id
          AND (
            e.state <> 'pending_human_review'
            OR (e.sla_breached <> 0 AND e.sla_reminder_sent_at IS NOT NULL)
          )`
    );

    return tx.queryAll(
      `WITH candidates AS MATERIALIZED (
         SELECT e.id, e.workspace_id
           FROM escalation_requests e
          WHERE e.state = 'pending_human_review'
            AND e.sla_due_at IS NOT NULL
            AND TRIM(e.sla_due_at::text) <> ''
            AND CASE
              WHEN e.sla_due_at::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]'
                THEN e.sla_due_at::timestamptz < NOW()
              ELSE FALSE
            END
            AND (e.sla_breached = 0 OR e.sla_reminder_sent_at IS NULL)
            AND ($4::text IS NULL OR e.workspace_id = $4)
            AND NOT EXISTS (
              SELECT 1
                FROM escalation_sla_sweep_claims active_claim
               WHERE active_claim.escalation_id = e.id
                 AND active_claim.lease_until > NOW()
            )
          ORDER BY e.sla_due_at ASC, e.id ASC
          LIMIT $1
          FOR UPDATE OF e SKIP LOCKED
       ),
       claimed AS (
         INSERT INTO escalation_sla_sweep_claims
           (escalation_id, workspace_id, claimed_by, claimed_at, lease_until,
            attempt_count, last_error, updated_at)
         SELECT
           candidate.id,
           candidate.workspace_id,
           $2,
           NOW(),
           NOW() + ($3::bigint * INTERVAL '1 millisecond'),
           1,
           NULL,
           NOW()
         FROM candidates candidate
         ON CONFLICT (escalation_id) DO UPDATE
           SET workspace_id = EXCLUDED.workspace_id,
               claimed_by = EXCLUDED.claimed_by,
               claimed_at = EXCLUDED.claimed_at,
               lease_until = EXCLUDED.lease_until,
               attempt_count = escalation_sla_sweep_claims.attempt_count + 1,
               last_error = NULL,
               updated_at = EXCLUDED.updated_at
         WHERE escalation_sla_sweep_claims.lease_until <= NOW()
         RETURNING escalation_id
       )
       SELECT e.*, r.version AS release_version
         FROM escalation_requests e
         LEFT JOIN releases r ON r.id = e.release_id
         JOIN claimed c ON c.escalation_id = e.id
        ORDER BY e.sla_due_at ASC, e.id ASC`,
      [batchLimit, owner, boundedLeaseMs, workspaceScope]
    );
  });
}

async function completeEscalationSlaSweepClaim(escalationId, workerId, runFn = run) {
  return runFn(
    `DELETE FROM escalation_sla_sweep_claims
      WHERE escalation_id = $1 AND claimed_by = $2`,
    [escalationId, workerId]
  );
}

async function ownsActiveEscalationSlaSweepClaim(
  escalationId,
  workerId,
  queryOneFn = queryOne
) {
  const row = await queryOneFn(
    `SELECT escalation_id
       FROM escalation_sla_sweep_claims
      WHERE escalation_id = $1
        AND claimed_by = $2
        AND lease_until > NOW()`,
    [escalationId, workerId]
  );
  return !!row;
}

async function recordEscalationSlaSweepClaimFailure(
  escalationId,
  workerId,
  error,
  runFn = run
) {
  const message = String(error?.message || error || "escalation SLA sweep failed").slice(0, 1000);
  return runFn(
    `UPDATE escalation_sla_sweep_claims
        SET last_error = $1,
            updated_at = NOW()
      WHERE escalation_id = $2 AND claimed_by = $3`,
    [message, escalationId, workerId]
  );
}

module.exports = {
  claimDueEscalations,
  completeEscalationSlaSweepClaim,
  ownsActiveEscalationSlaSweepClaim,
  recordEscalationSlaSweepClaimFailure,
  DEFAULT_LEASE_MS,
  MAX_LEASE_MS
};
