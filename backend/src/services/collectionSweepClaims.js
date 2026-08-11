"use strict";

const { transaction, run } = require("../database");

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const MAX_LEASE_MS = 60 * 60 * 1000;

function boundedPositiveInt(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

/**
 * Atomically leases due releases to one worker without holding a transaction
 * open while verdict evaluation runs.
 */
async function claimDueCollectionReleases({
  limit,
  workerId,
  leaseMs = DEFAULT_LEASE_MS,
  workspaceId = null,
  transactionFn = transaction
}) {
  const batchLimit = boundedPositiveInt(limit, 100, 1000);
  const boundedLeaseMs = boundedPositiveInt(leaseMs, DEFAULT_LEASE_MS, MAX_LEASE_MS);
  const owner = String(workerId || "").trim();
  if (!owner) throw new Error("collection sweep workerId is required");
  const workspaceScope = String(workspaceId || "").trim() || null;

  return transactionFn(async (tx) => {
    // Clean up claims left behind after a worker committed a verdict but died
    // before deleting its lease.
    await tx.run(
      `DELETE FROM collection_sweep_claims c
        USING releases r
        WHERE c.release_id = r.id
          AND r.status <> 'COLLECTING'`
    );

    return tx.queryAll(
      `WITH candidates AS MATERIALIZED (
         SELECT r.id, r.workspace_id
           FROM releases r
          WHERE r.status = 'COLLECTING'
            AND r.collection_deadline IS NOT NULL
            AND r.collection_deadline <= NOW()
            AND ($4::text IS NULL OR r.workspace_id = $4)
            AND NOT EXISTS (
              SELECT 1
                FROM collection_sweep_claims active_claim
               WHERE active_claim.release_id = r.id
                 AND active_claim.lease_until > NOW()
            )
          ORDER BY r.collection_deadline ASC, r.id ASC
          LIMIT $1
          FOR UPDATE OF r SKIP LOCKED
       ),
       claimed AS (
         INSERT INTO collection_sweep_claims
           (release_id, workspace_id, claimed_by, claimed_at, lease_until, attempt_count, last_error, updated_at)
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
         ON CONFLICT (release_id) DO UPDATE
           SET workspace_id = EXCLUDED.workspace_id,
               claimed_by = EXCLUDED.claimed_by,
               claimed_at = EXCLUDED.claimed_at,
               lease_until = EXCLUDED.lease_until,
               attempt_count = collection_sweep_claims.attempt_count + 1,
               last_error = NULL,
               updated_at = EXCLUDED.updated_at
         WHERE collection_sweep_claims.lease_until <= NOW()
         RETURNING release_id
       )
       SELECT r.*
         FROM releases r
         JOIN claimed c ON c.release_id = r.id
        ORDER BY r.collection_deadline ASC, r.id ASC`,
      [batchLimit, owner, boundedLeaseMs, workspaceScope]
    );
  });
}

async function completeCollectionSweepClaim(releaseId, workerId, runFn = run) {
  return runFn(
    `DELETE FROM collection_sweep_claims
      WHERE release_id = $1 AND claimed_by = $2`,
    [releaseId, workerId]
  );
}

async function recordCollectionSweepClaimFailure(releaseId, workerId, error, runFn = run) {
  const message = String(error?.message || error || "collection sweep evaluation failed").slice(0, 1000);
  return runFn(
    `UPDATE collection_sweep_claims
        SET last_error = $1,
            updated_at = NOW()
      WHERE release_id = $2 AND claimed_by = $3`,
    [message, releaseId, workerId]
  );
}

module.exports = {
  claimDueCollectionReleases,
  completeCollectionSweepClaim,
  recordCollectionSweepClaimFailure,
  DEFAULT_LEASE_MS,
  MAX_LEASE_MS
};
