"use strict";

const { run, queryAll, transaction } = require("../database");
const certificationSnapshots = require("./certificationSnapshots");
const { writeAudit } = require("./audit");
const { isCertLikeStatus } = require("../lib/releaseStatus");
const { log, inc } = require("../lib/observability");

const MAX_ATTEMPTS = 4;
/** Delay before retry attempt N (index = attempt after the initial sync failure). */
const BACKOFF_MS = [0, 2000, 10000, 30000];
const CLAIM_LEASE_MS = 120_000;

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
 * Claim and process due retry rows. Safe across multiple workers (SKIP LOCKED).
 * @returns {{ processed: number, succeeded: number, failed: number, exhausted: number }}
 */
async function processDueCertificationSnapshotRetries({ limit = 25 } = {}) {
  const claimed = await transaction(async (tx) => {
    const due = await tx.queryAll(
      `SELECT *
         FROM certification_snapshot_retries
        WHERE next_attempt_at <= NOW()
        ORDER BY next_attempt_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
    for (const row of due) {
      await tx.run(
        `UPDATE certification_snapshot_retries
            SET next_attempt_at = $2::timestamptz, updated_at = NOW()
          WHERE release_id = $1`,
        [row.release_id, leaseUntil]
      );
    }
    return due;
  });

  let succeeded = 0;
  let failed = 0;
  let exhausted = 0;

  for (const row of claimed) {
    const args = rowToArgs(row);
    try {
      await certificationSnapshots.persistCertificationSnapshot(args);
      await run(`DELETE FROM certification_snapshot_retries WHERE release_id = $1`, [row.release_id]);
      succeeded += 1;
    } catch (err) {
      const nextAttempt = Number(row.attempt) + 1;
      if (nextAttempt >= MAX_ATTEMPTS) {
        await run(`DELETE FROM certification_snapshot_retries WHERE release_id = $1`, [row.release_id]);
        await onFinalFailure(args, err);
        exhausted += 1;
      } else {
        await enqueueRetryJob(args, nextAttempt, err);
        failed += 1;
      }
    }
  }

  return {
    processed: claimed.length,
    succeeded,
    failed,
    exhausted
  };
}

/** Test helper — clears pending retry rows. */
async function _resetCertificationSnapshotRetryState() {
  await run(`DELETE FROM certification_snapshot_retries`);
}

module.exports = {
  enqueueCertificationSnapshotPersist,
  processDueCertificationSnapshotRetries,
  enqueueRetryJob,
  _resetCertificationSnapshotRetryState,
  MAX_ATTEMPTS,
  BACKOFF_MS
};
