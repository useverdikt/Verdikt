"use strict";

const crypto = require("crypto");
const os = require("os");
const { queryAll } = require("../database");
const { evaluateReleaseAfterSignalIngest } = require("../services/domain");
const {
  claimDueCollectionReleases,
  completeCollectionSweepClaim,
  recordCollectionSweepClaimFailure,
  DEFAULT_LEASE_MS
} = require("../services/collectionSweepClaims");
const { log, inc } = require("../lib/observability");

const CONFIGURED_BATCH_SIZE = Number(process.env.COLLECTION_SWEEP_BATCH_SIZE || 100);
const DEFAULT_BATCH_SIZE = Number.isFinite(CONFIGURED_BATCH_SIZE)
  ? Math.min(1000, Math.max(1, Math.floor(CONFIGURED_BATCH_SIZE)))
  : 100;
const CONFIGURED_LEASE_MS = Number(process.env.COLLECTION_SWEEP_CLAIM_LEASE_MS || DEFAULT_LEASE_MS);
const DEFAULT_WORKER_ID =
  String(process.env.COLLECTION_SWEEP_WORKER_ID || "").trim() ||
  `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;

function resolveCollectionSweepClaimMode(raw = process.env.COLLECTION_SWEEP_CLAIM_MODE) {
  const normalized = String(raw || "observe").trim().toLowerCase();
  return ["off", "observe", "enforce"].includes(normalized) ? normalized : "observe";
}

async function loadDueCollectionReleases(queryAllFn, batchLimit) {
  return queryAllFn(
    `SELECT *
       FROM releases
      WHERE status = 'COLLECTING'
        AND collection_deadline IS NOT NULL
        AND collection_deadline <= NOW()
      ORDER BY collection_deadline ASC, id ASC
      LIMIT $1`,
    [batchLimit]
  );
}

async function runCollectionDeadlineSweep({
  limit = DEFAULT_BATCH_SIZE,
  claimMode = resolveCollectionSweepClaimMode(),
  workerId = DEFAULT_WORKER_ID,
  leaseMs = CONFIGURED_LEASE_MS,
  queryAllFn = queryAll,
  evaluateFn = evaluateReleaseAfterSignalIngest,
  claimBatchFn = claimDueCollectionReleases,
  completeClaimFn = completeCollectionSweepClaim,
  failClaimFn = recordCollectionSweepClaimFailure,
  logFn = log,
  incFn = inc
} = {}) {
  const batchLimit = Math.min(1000, Math.max(1, Number(limit) || DEFAULT_BATCH_SIZE));
  const mode = resolveCollectionSweepClaimMode(claimMode);
  const rows =
    mode === "enforce"
      ? await claimBatchFn({ limit: batchLimit, workerId, leaseMs })
      : await loadDueCollectionReleases(queryAllFn, batchLimit);

  if (rows.length > 0 && mode !== "off") {
    logFn("info", mode === "enforce" ? "collection_sweep_claimed" : "collection_sweep_claim_observed", {
      mode,
      workerId,
      releaseCount: rows.length,
      leaseMs: mode === "enforce" ? Number(leaseMs) : undefined
    });
    incFn(mode === "enforce" ? "collection_sweep_claimed" : "collection_sweep_observed", rows.length);
  }

  let succeeded = 0;
  let failed = 0;
  for (const rel of rows) {
    try {
      await evaluateFn(rel, rel.id, "collection_deadline_sweep", 0);
      succeeded += 1;
      incFn("collection_sweep_succeeded");
      if (mode === "enforce") {
        try {
          await completeClaimFn(rel.id, workerId);
        } catch (claimErr) {
          logFn("error", "collection_sweep_claim_complete_failed", {
            releaseId: rel.id,
            workerId,
            error: String(claimErr?.message || claimErr).slice(0, 500)
          });
          incFn("collection_sweep_claim_complete_failed");
        }
      }
    } catch (err) {
      failed += 1;
      incFn("collection_sweep_failed");
      if (mode === "enforce") {
        try {
          await failClaimFn(rel.id, workerId, err);
        } catch (claimErr) {
          logFn("error", "collection_sweep_claim_failure_record_failed", {
            releaseId: rel.id,
            workerId,
            error: String(claimErr?.message || claimErr).slice(0, 500)
          });
          incFn("collection_sweep_claim_failure_record_failed");
        }
      }
      logFn("error", "collection_deadline_sweep_failed", {
        releaseId: rel.id,
        workerId,
        mode,
        error: String(err?.message || err).slice(0, 500)
      });
    }
  }

  return {
    mode,
    worker_id: workerId,
    selected: rows.length,
    succeeded,
    failed
  };
}

function startCollectionDeadlineSweepJob() {
  const id = setInterval(() => {
    void runCollectionDeadlineSweep().catch((err) => {
      log("error", "collection_deadline_sweep_unhandled", {
        error: String(err?.message || err).slice(0, 500)
      });
      inc("collection_sweep_unhandled");
    });
  }, 60 * 1000);
  if (typeof id.unref === "function") id.unref();
  return id;
}

module.exports = {
  runCollectionDeadlineSweep,
  startCollectionDeadlineSweepJob,
  resolveCollectionSweepClaimMode,
  DEFAULT_BATCH_SIZE
};
