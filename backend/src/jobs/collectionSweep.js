"use strict";

const { queryAll } = require("../database");
const { evaluateReleaseAfterSignalIngest } = require("../services/domain");

const CONFIGURED_BATCH_SIZE = Number(process.env.COLLECTION_SWEEP_BATCH_SIZE || 100);
const DEFAULT_BATCH_SIZE = Number.isFinite(CONFIGURED_BATCH_SIZE)
  ? Math.min(1000, Math.max(1, Math.floor(CONFIGURED_BATCH_SIZE)))
  : 100;

async function runCollectionDeadlineSweep({
  limit = DEFAULT_BATCH_SIZE,
  queryAllFn = queryAll,
  evaluateFn = evaluateReleaseAfterSignalIngest
} = {}) {
  const batchLimit = Math.min(1000, Math.max(1, Number(limit) || DEFAULT_BATCH_SIZE));
  const rows = await queryAllFn(
    `SELECT *
       FROM releases
      WHERE status = 'COLLECTING'
        AND collection_deadline IS NOT NULL
        AND collection_deadline <= NOW()
      ORDER BY collection_deadline ASC, id ASC
      LIMIT $1`,
    [batchLimit]
  );
  for (const rel of rows) {
    try {
      await evaluateFn(rel, rel.id, "collection_deadline_sweep", 0);
    } catch (err) {
      console.error("[collection_deadline_sweep]", rel.id, err);
    }
  }
}

function startCollectionDeadlineSweepJob() {
  const id = setInterval(() => {
    void runCollectionDeadlineSweep();
  }, 60 * 1000);
  if (typeof id.unref === "function") id.unref();
  return id;
}

module.exports = {
  runCollectionDeadlineSweep,
  startCollectionDeadlineSweepJob,
  DEFAULT_BATCH_SIZE
};
