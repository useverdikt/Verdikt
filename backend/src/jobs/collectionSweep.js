"use strict";

const { queryAll } = require("../database");
const { evaluateReleaseAfterSignalIngest } = require("../services/domain");

async function runCollectionDeadlineSweep() {
  const nowMs = Date.now();
  const rows = await queryAll(
    "SELECT * FROM releases WHERE status = 'COLLECTING' AND collection_deadline IS NOT NULL AND TRIM(collection_deadline) != ''",
    []
  );
  for (const rel of rows) {
    const deadlineMs = Date.parse(rel.collection_deadline);
    if (!Number.isFinite(deadlineMs) || deadlineMs >= nowMs) continue;
    try {
      await evaluateReleaseAfterSignalIngest(rel, rel.id, "collection_deadline_sweep", 0);
    } catch (err) {
      console.error("[collection_deadline_sweep]", rel.id, err);
    }
  }
}

function startCollectionDeadlineSweepJob() {
  const id = setInterval(() => {
    void runCollectionDeadlineSweep();
  }, 5 * 60 * 1000);
  if (typeof id.unref === "function") id.unref();
  return id;
}

module.exports = { runCollectionDeadlineSweep, startCollectionDeadlineSweepJob };
