"use strict";

const { transaction, queryOne, run } = require("../database");

const RETRY_CLAIM_LEASE_MS = 120_000;
const BACKFILL_CLAIM_LEASE_MS = 5 * 60 * 1000;
const MAX_LEASE_MS = 60 * 60 * 1000;

function boundedPositiveInt(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

async function claimDueCertificationSnapshotRetries({
  limit = 25,
  workerId,
  leaseMs = RETRY_CLAIM_LEASE_MS,
  transactionFn = transaction
}) {
  const batchLimit = boundedPositiveInt(limit, 25, 500);
  const boundedLeaseMs = boundedPositiveInt(leaseMs, RETRY_CLAIM_LEASE_MS, MAX_LEASE_MS);
  const owner = String(workerId || "").trim();
  if (!owner) throw new Error("certification snapshot retry workerId is required");

  return transactionFn((tx) =>
    tx.queryAll(
      `WITH candidates AS MATERIALIZED (
         SELECT release_id
           FROM certification_snapshot_retries
          WHERE next_attempt_at <= NOW()
            AND (claimed_by IS NULL OR lease_until IS NULL OR lease_until <= NOW())
          ORDER BY next_attempt_at ASC, release_id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE certification_snapshot_retries retry
          SET claimed_by = $2,
              lease_until = NOW() + ($3::bigint * INTERVAL '1 millisecond'),
              updated_at = NOW()
         FROM candidates
        WHERE retry.release_id = candidates.release_id
       RETURNING retry.*`,
      [batchLimit, owner, boundedLeaseMs]
    )
  );
}

async function ownsActiveCertificationSnapshotRetryClaim(
  releaseId,
  workerId,
  queryOneFn = queryOne
) {
  const row = await queryOneFn(
    `SELECT release_id
       FROM certification_snapshot_retries
      WHERE release_id = $1
        AND claimed_by = $2
        AND lease_until > NOW()`,
    [releaseId, workerId]
  );
  return !!row;
}

async function completeCertificationSnapshotRetryClaim(releaseId, workerId, runFn = run) {
  return runFn(
    `DELETE FROM certification_snapshot_retries
      WHERE release_id = $1 AND claimed_by = $2`,
    [releaseId, workerId]
  );
}

async function rescheduleCertificationSnapshotRetryClaim(
  { args, attempt, nextAttemptAt, error, workerId },
  runFn = run
) {
  const lastError = String(error?.message || error || "persist_failed").slice(0, 500);
  return runFn(
    `UPDATE certification_snapshot_retries
        SET workspace_id = $1,
            status_at_verdict = $2,
            threshold_snapshot_json = $3,
            signal_snapshot_json = $4,
            allow_update = $5,
            attempt = $6,
            next_attempt_at = $7::timestamptz,
            last_error = $8,
            claimed_by = NULL,
            lease_until = NULL,
            updated_at = NOW()
      WHERE release_id = $9 AND claimed_by = $10`,
    [
      args.workspaceId,
      String(args.status || "").toUpperCase(),
      JSON.stringify(args.thresholdMap || {}),
      JSON.stringify(args.signalMap || {}),
      args.allowUpdate ? 1 : 0,
      attempt,
      nextAttemptAt,
      lastError,
      args.releaseId,
      workerId
    ]
  );
}

async function claimMissingCertificationSnapshots({
  limit = 100,
  workerId,
  leaseMs = BACKFILL_CLAIM_LEASE_MS,
  releaseId = null,
  workspaceId = null,
  transactionFn = transaction
}) {
  const batchLimit = boundedPositiveInt(limit, 100, 500);
  const boundedLeaseMs = boundedPositiveInt(leaseMs, BACKFILL_CLAIM_LEASE_MS, MAX_LEASE_MS);
  const owner = String(workerId || "").trim();
  if (!owner) throw new Error("certification snapshot backfill workerId is required");
  const releaseScope = String(releaseId || "").trim() || null;
  const workspaceScope = String(workspaceId || "").trim() || null;

  return transactionFn(async (tx) => {
    await tx.run(
      `DELETE FROM certification_snapshot_backfill_claims claim
        USING releases r
        WHERE claim.release_id = r.id
          AND (
            r.status NOT IN ('CERTIFIED', 'CERTIFIED_WITH_OVERRIDE')
            OR EXISTS (
              SELECT 1 FROM certification_snapshots snapshot
               WHERE snapshot.release_id = r.id
            )
            OR EXISTS (
              SELECT 1 FROM certification_snapshot_retries retry
               WHERE retry.release_id = r.id
            )
          )`
    );

    return tx.queryAll(
      `WITH candidates AS MATERIALIZED (
         SELECT r.id, r.workspace_id, r.status
           FROM releases r
          WHERE r.status IN ('CERTIFIED', 'CERTIFIED_WITH_OVERRIDE')
            AND ($4::text IS NULL OR r.id = $4)
            AND ($5::text IS NULL OR r.workspace_id = $5)
            AND NOT EXISTS (
              SELECT 1 FROM certification_snapshots snapshot
               WHERE snapshot.release_id = r.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM certification_snapshot_retries retry
               WHERE retry.release_id = r.id
            )
            AND NOT EXISTS (
              SELECT 1
                FROM certification_snapshot_backfill_claims active_claim
               WHERE active_claim.release_id = r.id
                 AND active_claim.lease_until > NOW()
            )
          ORDER BY r.created_at ASC, r.id ASC
          LIMIT $1
          FOR UPDATE OF r SKIP LOCKED
       ),
       claimed AS (
         INSERT INTO certification_snapshot_backfill_claims
           (release_id, workspace_id, claimed_by, claimed_at, lease_until,
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
         ON CONFLICT (release_id) DO UPDATE
           SET workspace_id = EXCLUDED.workspace_id,
               claimed_by = EXCLUDED.claimed_by,
               claimed_at = EXCLUDED.claimed_at,
               lease_until = EXCLUDED.lease_until,
               attempt_count = certification_snapshot_backfill_claims.attempt_count + 1,
               last_error = NULL,
               updated_at = EXCLUDED.updated_at
         WHERE certification_snapshot_backfill_claims.lease_until <= NOW()
         RETURNING release_id
       )
       SELECT candidate.id AS release_id, candidate.workspace_id, candidate.status
         FROM candidates candidate
         JOIN claimed ON claimed.release_id = candidate.id
        ORDER BY candidate.id ASC`,
      [batchLimit, owner, boundedLeaseMs, releaseScope, workspaceScope]
    );
  });
}

async function ownsActiveCertificationSnapshotBackfillClaim(
  releaseId,
  workerId,
  queryOneFn = queryOne
) {
  const row = await queryOneFn(
    `SELECT release_id
       FROM certification_snapshot_backfill_claims
      WHERE release_id = $1
        AND claimed_by = $2
        AND lease_until > NOW()`,
    [releaseId, workerId]
  );
  return !!row;
}

async function completeCertificationSnapshotBackfillClaim(releaseId, workerId, runFn = run) {
  return runFn(
    `DELETE FROM certification_snapshot_backfill_claims
      WHERE release_id = $1 AND claimed_by = $2`,
    [releaseId, workerId]
  );
}

async function recordCertificationSnapshotBackfillClaimFailure(
  releaseId,
  workerId,
  error,
  runFn = run
) {
  const message = String(error?.message || error || "snapshot backfill failed").slice(0, 1000);
  return runFn(
    `UPDATE certification_snapshot_backfill_claims
        SET last_error = $1,
            updated_at = NOW()
      WHERE release_id = $2 AND claimed_by = $3`,
    [message, releaseId, workerId]
  );
}

module.exports = {
  claimDueCertificationSnapshotRetries,
  ownsActiveCertificationSnapshotRetryClaim,
  completeCertificationSnapshotRetryClaim,
  rescheduleCertificationSnapshotRetryClaim,
  claimMissingCertificationSnapshots,
  ownsActiveCertificationSnapshotBackfillClaim,
  completeCertificationSnapshotBackfillClaim,
  recordCertificationSnapshotBackfillClaimFailure,
  RETRY_CLAIM_LEASE_MS,
  BACKFILL_CLAIM_LEASE_MS,
  MAX_LEASE_MS
};
