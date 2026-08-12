"use strict";

const crypto = require("crypto");
const os = require("os");
const {
  processDueCertificationSnapshotRetries,
  backfillMissingCertificationSnapshots
} = require("../services/certificationSnapshotRetry");
const {
  RETRY_CLAIM_LEASE_MS,
  BACKFILL_CLAIM_LEASE_MS
} = require("../services/certificationSnapshotClaims");

const WORKER_INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;
const RETRY_WORKER_ID =
  String(process.env.CERT_SNAPSHOT_RETRY_WORKER_ID || "").trim() ||
  `cert-snapshot-retry:${WORKER_INSTANCE_ID}`;
const BACKFILL_WORKER_ID =
  String(process.env.CERT_SNAPSHOT_BACKFILL_WORKER_ID || "").trim() ||
  `cert-snapshot-backfill:${WORKER_INSTANCE_ID}`;

async function runCertificationSnapshotRetrySweepOnce({
  workerId = RETRY_WORKER_ID,
  leaseMs = Number(process.env.CERT_SNAPSHOT_RETRY_CLAIM_LEASE_MS || RETRY_CLAIM_LEASE_MS),
  processFn = processDueCertificationSnapshotRetries
} = {}) {
  try {
    const result = await processFn({ workerId, leaseMs });
    if (result.processed > 0) {
      console.info(
        "[cert_snapshot_retry_sweep]",
        `processed=${result.processed} succeeded=${result.succeeded} retried=${result.failed} exhausted=${result.exhausted}`
      );
    }
    return result;
  } catch (err) {
    console.error("[cert_snapshot_retry_sweep]", err);
    return null;
  }
}

async function runCertificationSnapshotBackfillOnce({
  workerId = BACKFILL_WORKER_ID,
  leaseMs = Number(process.env.CERT_SNAPSHOT_BACKFILL_CLAIM_LEASE_MS || BACKFILL_CLAIM_LEASE_MS),
  backfillFn = backfillMissingCertificationSnapshots
} = {}) {
  try {
    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    // Backfill in batches until no more missing snapshots are found, so legacy
    // deployments with hundreds of pre-existing certified releases are fully covered.
    for (let i = 0; i < 50; i += 1) {
      const result = await backfillFn({ limit: 100, workerId, leaseMs });
      if (!result || result.processed === 0) break;
      totalProcessed += result.processed;
      totalSucceeded += result.succeeded;
      totalFailed += result.failed;
    }
    if (totalProcessed > 0) {
      console.info(
        "[cert_snapshot_backfill]",
        `processed=${totalProcessed} succeeded=${totalSucceeded} failed=${totalFailed}`
      );
    }
    return { processed: totalProcessed, succeeded: totalSucceeded, failed: totalFailed };
  } catch (err) {
    console.error("[cert_snapshot_backfill]", err);
    return null;
  }
}

function startCertificationSnapshotRetrySweepJob() {
  const intervalMs = Math.max(
    1_000,
    Number(process.env.CERT_SNAPSHOT_RETRY_SWEEP_MS || 2_000)
  );
  const id = setInterval(() => {
    void runCertificationSnapshotRetrySweepOnce();
  }, intervalMs);
  if (typeof id.unref === "function") id.unref();
  return id;
}

module.exports = {
  runCertificationSnapshotRetrySweepOnce,
  runCertificationSnapshotBackfillOnce,
  startCertificationSnapshotRetrySweepJob
};
