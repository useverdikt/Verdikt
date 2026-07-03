"use strict";

const { persistCertificationSnapshot } = require("./certificationSnapshots");
const { writeAudit } = require("./audit");
const { isCertLikeStatus } = require("../lib/releaseStatus");

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [0, 2000, 10000, 30000];

/** @type {Map<string, { args: object, attempt: number, timer: NodeJS.Timeout }>} */
const inFlight = new Map();

async function onFinalFailure(args, err) {
  console.error("[certification_snapshot] exhausted retries:", args.releaseId, err?.message);
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
    console.error("[certification_snapshot] audit on failure failed:", args.releaseId, auditErr?.message);
  }
}

function scheduleRetry(args, attempt) {
  const existing = inFlight.get(args.releaseId);
  if (existing?.timer) clearTimeout(existing.timer);

  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  const timer = setTimeout(async () => {
    try {
      await persistCertificationSnapshot(args);
      inFlight.delete(args.releaseId);
    } catch (err) {
      const nextAttempt = attempt + 1;
      if (nextAttempt >= MAX_ATTEMPTS) {
        inFlight.delete(args.releaseId);
        await onFinalFailure(args, err);
      } else {
        scheduleRetry(args, nextAttempt);
      }
    }
  }, delay);

  inFlight.set(args.releaseId, { args, attempt, timer });
}

/**
 * Persist certification snapshot; on failure schedule exponential backoff retries.
 * Cert-like statuses get a CERTIFICATION_SNAPSHOT_FAILED audit after all attempts.
 */
async function enqueueCertificationSnapshotPersist(args) {
  try {
    return await persistCertificationSnapshot(args);
  } catch (err) {
    console.error("[certification_snapshot] persist failed:", args.releaseId, err?.message);
    scheduleRetry(args, 1);
    return null;
  }
}

/** Test helper — clears pending retry timers. */
function _resetCertificationSnapshotRetryState() {
  for (const entry of inFlight.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  inFlight.clear();
}

module.exports = {
  enqueueCertificationSnapshotPersist,
  _resetCertificationSnapshotRetryState,
  MAX_ATTEMPTS,
  BACKOFF_MS
};
