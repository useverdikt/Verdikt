"use strict";

const { run } = require("../database");
const certificationSnapshots = require("./certificationSnapshots");
const { writeAudit } = require("./audit");
const { isCertLikeStatus } = require("../lib/releaseStatus");
const { getThresholdMap } = require("./workspaceConfig");
const { getLatestSignalMap } = require("./verdictEngine");
const {
  claimDueCertificationSnapshotRetries,
  ownsActiveCertificationSnapshotRetryClaim,
  completeCertificationSnapshotRetryClaim,
  rescheduleCertificationSnapshotRetryClaim,
  claimMissingCertificationSnapshots,
  ownsActiveCertificationSnapshotBackfillClaim,
  completeCertificationSnapshotBackfillClaim,
  recordCertificationSnapshotBackfillClaimFailure,
  RETRY_CLAIM_LEASE_MS,
  BACKFILL_CLAIM_LEASE_MS
} = require("./certificationSnapshotClaims");
const { log, inc } = require("../lib/observability");

const MAX_ATTEMPTS = 4;
/** Delay before retry attempt N (index = attempt after the initial sync failure). */
const BACKOFF_MS = [0, 2000, 10000, 30000];

function backoffMsForAttempt(attempt) {
  return BACKOFF_MS[Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1)];
}

function nextAttemptAtIso(attempt) {
  return new Date(Date.now() + backoffMsForAttempt(attempt)).toISOString();
}

async function onFinalFailure(args, err) {
  inc("cert_snapshot_exhausted");
  log("error", "cert_snapshot_exhausted", {
    releaseId: args.releaseId,
    workspaceId: args.workspaceId,
    status: args.status,
    attempts: MAX_ATTEMPTS,
    error: String(err?.message || "persist_failed").slice(0, 200)
  });
  if (!isCertLikeStatus(args.status)) return;
  try {
    await writeAudit({
      workspaceId: args.workspaceId,
      releaseId: args.releaseId,
      eventType: "CERTIFICATION_SNAPSHOT_FAILED",
      actorType: "SYSTEM",
      actorName: "certification_snapshot_retry",
      details: {
        status: args.status,
        attempts: MAX_ATTEMPTS,
        error: String(err?.message || "persist_failed").slice(0, 200)
      }
    });
  } catch (auditErr) {
    log("error", "cert_snapshot_audit_failed", {
      releaseId: args.releaseId,
      error: String(auditErr?.message || auditErr).slice(0, 200)
    });
  }
}

function rowToArgs(row) {
  let thresholdMap = {};
  let signalMap = {};
  try {
    thresholdMap = JSON.parse(row.threshold_snapshot_json || "{}");
  } catch {
    thresholdMap = {};
  }
  try {
    signalMap = JSON.parse(row.signal_snapshot_json || "{}");
  } catch {
    signalMap = {};
  }
  return {
    releaseId: row.release_id,
    workspaceId: row.workspace_id,
    thresholdMap,
    signalMap,
    status: row.status_at_verdict,
    allowUpdate: Number(row.allow_update) === 1
  };
}

/**
 * Persist a failed snapshot job for durable retry (survives restart / multi-instance).
 */
async function enqueueRetryJob(args, attempt, err) {
  const statusAtVerdict = String(args.status || "").toUpperCase();
  const nextAt = nextAttemptAtIso(attempt);
  const lastError = String(err?.message || "persist_failed").slice(0, 500);
  await run(
    `INSERT INTO certification_snapshot_retries (
       release_id, workspace_id, status_at_verdict,
       threshold_snapshot_json, signal_snapshot_json, allow_update,
       attempt, next_attempt_at, last_error, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, NOW(), NOW())
     ON CONFLICT (release_id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       status_at_verdict = EXCLUDED.status_at_verdict,
       threshold_snapshot_json = EXCLUDED.threshold_snapshot_json,
       signal_snapshot_json = EXCLUDED.signal_snapshot_json,
       allow_update = EXCLUDED.allow_update,
       attempt = EXCLUDED.attempt,
       next_attempt_at = EXCLUDED.next_attempt_at,
       last_error = EXCLUDED.last_error,
       claimed_by = NULL,
       lease_until = NULL,
       updated_at = NOW()`,
    [
      args.releaseId,
      args.workspaceId,
      statusAtVerdict,
      JSON.stringify(args.thresholdMap || {}),
      JSON.stringify(args.signalMap || {}),
      args.allowUpdate ? 1 : 0,
      attempt,
      nextAt,
      lastError
    ]
  );
}

/**
 * Persist certification snapshot; on failure enqueue a durable retry job.
 * Cert-like statuses get a CERTIFICATION_SNAPSHOT_FAILED audit after all attempts.
 */
async function enqueueCertificationSnapshotPersist(args) {
  try {
    return await certificationSnapshots.persistCertificationSnapshot(args);
  } catch (err) {
    inc("cert_snapshot_persist_fail");
    log("error", "cert_snapshot_persist_fail", {
      releaseId: args.releaseId,
      workspaceId: args.workspaceId,
      status: args.status,
      error: String(err?.message || err).slice(0, 200)
    });
    try {
      await enqueueRetryJob(args, 1, err);
    } catch (enqueueErr) {
      log("error", "cert_snapshot_enqueue_fail", {
        releaseId: args.releaseId,
        error: String(enqueueErr?.message || enqueueErr).slice(0, 200)
      });
    }
    return null;
  }
}

/**
 * Claim and process due retry rows with owner-scoped completion.
 */
async function processDueCertificationSnapshotRetries({
  limit = 25,
  workerId = `cert-snapshot-retry:${process.pid}`,
  leaseMs = RETRY_CLAIM_LEASE_MS,
  claimBatchFn = claimDueCertificationSnapshotRetries,
  ownsClaimFn = ownsActiveCertificationSnapshotRetryClaim,
  completeClaimFn = completeCertificationSnapshotRetryClaim,
  rescheduleClaimFn = rescheduleCertificationSnapshotRetryClaim,
  persistFn = certificationSnapshots.persistCertificationSnapshot
} = {}) {
  const claimed = await claimBatchFn({ limit, workerId, leaseMs });
  let succeeded = 0;
  let failed = 0;
  let exhausted = 0;
  let ownershipLost = 0;

  for (const row of claimed) {
    const args = rowToArgs(row);
    if (!(await ownsClaimFn(row.release_id, workerId))) {
      ownershipLost += 1;
      inc("cert_snapshot_retry_ownership_lost");
      continue;
    }

    try {
      await persistFn(args);
      const completed = await completeClaimFn(row.release_id, workerId);
      if (completed.changes === 1) {
        succeeded += 1;
      } else {
        ownershipLost += 1;
        inc("cert_snapshot_retry_ownership_lost");
      }
    } catch (err) {
      const nextAttempt = Number(row.attempt) + 1;
      if (nextAttempt >= MAX_ATTEMPTS) {
        const completed = await completeClaimFn(row.release_id, workerId);
        if (completed.changes === 1) {
          await onFinalFailure(args, err);
          exhausted += 1;
        } else {
          ownershipLost += 1;
          inc("cert_snapshot_retry_ownership_lost");
        }
      } else {
        const rescheduled = await rescheduleClaimFn({
          args,
          attempt: nextAttempt,
          nextAttemptAt: nextAttemptAtIso(nextAttempt),
          error: err,
          workerId
        });
        if (rescheduled.changes === 1) {
          failed += 1;
        } else {
          ownershipLost += 1;
          inc("cert_snapshot_retry_ownership_lost");
        }
      }
    }
  }

  return {
    processed: claimed.length,
    succeeded,
    failed,
    exhausted,
    ownership_lost: ownershipLost
  };
}

/**
 * One-time backfill for certified releases created before certification snapshots existed.
 * For each certified release with no snapshot and no pending retry, compute the current
 * threshold map + latest signal map and enqueue a persist (or retry on failure).
 * Optional releaseId/workspaceId filters make it safe to target a specific release.
 */
async function backfillMissingCertificationSnapshots({
  limit = 100,
  releaseId = null,
  workspaceId = null,
  workerId = `cert-snapshot-backfill:${process.pid}`,
  leaseMs = BACKFILL_CLAIM_LEASE_MS,
  claimBatchFn = claimMissingCertificationSnapshots,
  ownsClaimFn = ownsActiveCertificationSnapshotBackfillClaim,
  completeClaimFn = completeCertificationSnapshotBackfillClaim,
  failClaimFn = recordCertificationSnapshotBackfillClaimFailure,
  getThresholdMapFn = getThresholdMap,
  getLatestSignalMapFn = getLatestSignalMap,
  enqueuePersistFn = enqueueCertificationSnapshotPersist
} = {}) {
  const rows = await claimBatchFn({
    limit,
    releaseId,
    workspaceId,
    workerId,
    leaseMs
  });
  let succeeded = 0;
  let failed = 0;
  let ownershipLost = 0;

  for (const row of rows) {
    try {
      if (!(await ownsClaimFn(row.release_id, workerId))) {
        ownershipLost += 1;
        inc("cert_snapshot_backfill_ownership_lost");
        continue;
      }
      const [thresholdMap, latest] = await Promise.all([
        getThresholdMapFn(row.workspace_id),
        getLatestSignalMapFn(row.release_id)
      ]);
      await enqueuePersistFn({
        releaseId: row.release_id,
        workspaceId: row.workspace_id,
        thresholdMap,
        signalMap: latest,
        status: row.status
      });
      const completed = await completeClaimFn(row.release_id, workerId);
      if (completed.changes === 1) {
        succeeded += 1;
      } else {
        ownershipLost += 1;
        inc("cert_snapshot_backfill_ownership_lost");
      }
    } catch (err) {
      failed += 1;
      try {
        await failClaimFn(row.release_id, workerId, err);
      } catch (claimErr) {
        log("error", "cert_snapshot_backfill_claim_failure_record_failed", {
          releaseId: row.release_id,
          workerId,
          error: String(claimErr?.message || claimErr).slice(0, 200)
        });
      }
      log("error", "cert_snapshot_backfill_failed", {
        releaseId: row.release_id,
        workspaceId: row.workspace_id,
        error: String(err?.message || err).slice(0, 200)
      });
    }
  }
  return { processed: rows.length, succeeded, failed, ownership_lost: ownershipLost };
}

/** Test helper — clears pending retry rows. */
async function _resetCertificationSnapshotRetryState() {
  await run(`DELETE FROM certification_snapshot_backfill_claims`);
  await run(`DELETE FROM certification_snapshot_retries`);
}

module.exports = {
  enqueueCertificationSnapshotPersist,
  processDueCertificationSnapshotRetries,
  backfillMissingCertificationSnapshots,
  enqueueRetryJob,
  _resetCertificationSnapshotRetryState,
  MAX_ATTEMPTS,
  BACKOFF_MS
};
