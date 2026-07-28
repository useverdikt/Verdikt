"use strict";

const {
  processDueCertificationSnapshotRetries,
  backfillMissingCertificationSnapshots
} = require("../services/certificationSnapshotRetry");

async function runCertificationSnapshotRetrySweepOnce() {
  try {
    const result = await processDueCertificationSnapshotRetries();
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

async function runCertificationSnapshotBackfillOnce() {
  try {
    let totalProcessed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    // Backfill in batches until no more missing snapshots are found, so legacy
    // deployments with hundreds of pre-existing certified releases are fully covered.
    for (let i = 0; i < 50; i += 1) {
      const result = await backfillMissingCertificationSnapshots({ limit: 100 });
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
