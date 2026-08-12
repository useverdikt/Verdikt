"use strict";

const { transaction, run } = require("../database");

const DEFAULT_LEASE_MS = 30 * 60 * 1000;
const MAX_LEASE_MS = 4 * 60 * 60 * 1000;
const DEFAULT_RESCAN_MS = 5 * 60 * 1000;

function boundedPositiveInt(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

/**
 * Atomically leases due VCS windows without holding a transaction open during
 * provider reads or production-evidence ingestion.
 */
async function claimDueVcsMonitoringWindows({
  limit,
  workerId,
  leaseMs = DEFAULT_LEASE_MS,
  minRescanMs = DEFAULT_RESCAN_MS,
  workspaceId = null,
  transactionFn = transaction
}) {
  const batchLimit = boundedPositiveInt(limit, 20, 100);
  const boundedLeaseMs = boundedPositiveInt(leaseMs, DEFAULT_LEASE_MS, MAX_LEASE_MS);
  const boundedRescanMs = boundedPositiveInt(minRescanMs, DEFAULT_RESCAN_MS, 24 * 60 * 60 * 1000);
  const owner = String(workerId || "").trim();
  if (!owner) throw new Error("VCS monitor sweep workerId is required");
  const workspaceScope = String(workspaceId || "").trim() || null;

  return transactionFn(async (tx) => {
    await tx.run(
      `DELETE FROM vcs_monitor_sweep_claims c
        USING vcs_monitoring_windows w
        WHERE c.release_id = w.release_id
          AND w.status NOT IN ('pending', 'scanning')`
    );

    return tx.queryAll(
      `WITH candidates AS MATERIALIZED (
         SELECT w.release_id, w.workspace_id
           FROM vcs_monitoring_windows w
          WHERE w.status IN ('pending', 'scanning')
            AND (
              w.last_scanned_at IS NULL
              OR w.last_scanned_at::timestamptz <=
                NOW() - ($4::bigint * INTERVAL '1 millisecond')
            )
            AND ($5::text IS NULL OR w.workspace_id = $5)
            AND NOT EXISTS (
              SELECT 1
                FROM vcs_monitor_sweep_claims active_claim
               WHERE active_claim.release_id = w.release_id
                 AND active_claim.lease_until > NOW()
            )
          ORDER BY w.monitoring_end ASC, w.release_id ASC
          LIMIT $1
          FOR UPDATE OF w SKIP LOCKED
       ),
       claimed AS (
         INSERT INTO vcs_monitor_sweep_claims
           (release_id, workspace_id, claimed_by, claimed_at, lease_until, attempt_count, last_error, updated_at)
         SELECT
           candidate.release_id,
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
               attempt_count = vcs_monitor_sweep_claims.attempt_count + 1,
               last_error = NULL,
               updated_at = EXCLUDED.updated_at
         WHERE vcs_monitor_sweep_claims.lease_until <= NOW()
         RETURNING release_id
       )
       SELECT w.*
         FROM vcs_monitoring_windows w
         JOIN claimed c ON c.release_id = w.release_id
        ORDER BY w.monitoring_end ASC, w.release_id ASC`,
      [batchLimit, owner, boundedLeaseMs, boundedRescanMs, workspaceScope]
    );
  });
}

async function completeVcsMonitorSweepClaim(releaseId, workerId, runFn = run) {
  return runFn(
    `DELETE FROM vcs_monitor_sweep_claims
      WHERE release_id = $1 AND claimed_by = $2`,
    [releaseId, workerId]
  );
}

async function recordVcsMonitorSweepClaimFailure(releaseId, workerId, error, runFn = run) {
  const message = String(error?.message || error || "VCS monitor scan failed").slice(0, 1000);
  return runFn(
    `UPDATE vcs_monitor_sweep_claims
        SET last_error = $1,
            updated_at = NOW()
      WHERE release_id = $2 AND claimed_by = $3`,
    [message, releaseId, workerId]
  );
}

module.exports = {
  claimDueVcsMonitoringWindows,
  completeVcsMonitorSweepClaim,
  recordVcsMonitorSweepClaimFailure,
  DEFAULT_LEASE_MS,
  DEFAULT_RESCAN_MS,
  MAX_LEASE_MS
};
