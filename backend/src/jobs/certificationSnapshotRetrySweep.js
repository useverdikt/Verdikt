"use strict";

const {
  processDueCertificationSnapshotRetries
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
  startCertificationSnapshotRetrySweepJob
};
