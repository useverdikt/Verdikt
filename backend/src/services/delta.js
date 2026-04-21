"use strict";

const { queryOne, queryAll, transaction } = require("../database");
const { AI_SIGNAL_IDS } = require("../config");
const { nowIso } = require("../lib/time");

async function getSignalMapForRelease(releaseId) {
  const rows = await queryAll("SELECT signal_id, value FROM signals WHERE release_id = ? ORDER BY id ASC", [releaseId]);
  const m = {};
  for (const row of rows) m[row.signal_id] = row.value;
  return m;
}

async function findBaselineRelease(workspaceId, currentReleaseId, currentCreatedAt) {
  const row = await queryOne(
    `SELECT id FROM releases
     WHERE workspace_id = ? AND id != ?
     AND status IN ('CERTIFIED', 'CERTIFIED_WITH_OVERRIDE')
     AND created_at::timestamptz < ?::timestamptz
     ORDER BY created_at::timestamptz DESC
     LIMIT 1`,
    [workspaceId, currentReleaseId, currentCreatedAt]
  );
  return row?.id || null;
}

function maxAllowedDrop(thresholdMap, signalId) {
  const t = thresholdMap[`${signalId}_delta`];
  if (!t) return null;
  if (t.min != null && Number.isFinite(Number(t.min))) return Number(t.min);
  if (t.max != null && Number.isFinite(Number(t.max))) return Number(t.max);
  return null;
}

async function analyzeReleaseDeltas({ workspaceId, releaseId, releaseRow, latest, thresholdMap }) {
  const failures = [];
  const createdAt = releaseRow?.created_at || nowIso();

  const baselineReleaseId = await findBaselineRelease(workspaceId, releaseId, createdAt);
  const baselineSignals = baselineReleaseId ? await getSignalMapForRelease(baselineReleaseId) : {};

  const snapshotRows = [];
  const pendingInserts = [];

  for (const signalId of AI_SIGNAL_IDS) {
    const maxDrop = maxAllowedDrop(thresholdMap, signalId);
    if (maxDrop == null) continue;

    const currentVal = latest[signalId];
    if (currentVal == null || !Number.isFinite(Number(currentVal))) continue;

    const baseVal = baselineReleaseId != null ? baselineSignals[signalId] : null;
    const ts = nowIso();

    if (baseVal == null || !Number.isFinite(Number(baseVal))) {
      pendingInserts.push([
        releaseId,
        workspaceId,
        signalId,
        baselineReleaseId,
        null,
        currentVal,
        maxDrop,
        null,
        1,
        ts
      ]);
      snapshotRows.push({
        signal_id: signalId,
        baseline_release_id: baselineReleaseId,
        baseline_value: null,
        current_value: currentVal,
        max_allowed_drop: maxDrop,
        drop_amount: null,
        passed: true,
        computed_at: ts,
        no_baseline: true
      });
      continue;
    }

    const drop = Number(baseVal) - Number(currentVal);
    const passed = drop <= maxDrop ? 1 : 0;

    pendingInserts.push([
      releaseId,
      workspaceId,
      signalId,
      baselineReleaseId,
      baseVal,
      currentVal,
      maxDrop,
      drop,
      passed,
      ts
    ]);

    snapshotRows.push({
      signal_id: signalId,
      baseline_release_id: baselineReleaseId,
      baseline_value: baseVal,
      current_value: currentVal,
      max_allowed_drop: maxDrop,
      drop_amount: drop,
      passed: passed === 1,
      computed_at: ts,
      no_baseline: false
    });

    if (!passed) {
      failures.push({
        signal_id: signalId,
        value: currentVal,
        failure_kind: "regression",
        baseline_value: baseVal,
        max_allowed_drop: maxDrop,
        drop_amount: drop,
        rule: `regression: −${drop.toFixed(1)} vs baseline ${baseVal} (max allowed drop ${maxDrop})`
      });
    }
  }

  return {
    failures,
    snapshot: snapshotRows,
    pendingInserts,
    baseline_release_id: baselineReleaseId,
    no_prior_certified_baseline: baselineReleaseId == null
  };
}

async function persistReleaseDeltas(releaseId, pendingInserts) {
  const insertSql = `INSERT INTO release_deltas (
      release_id, workspace_id, signal_id, baseline_release_id, baseline_value, current_value,
      max_allowed_drop, drop_amount, passed, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  await transaction(async (tx) => {
    await tx.run("DELETE FROM release_deltas WHERE release_id = ?", [releaseId]);
    for (const args of pendingInserts) {
      await tx.run(insertSql, args);
    }
  });
}

async function evaluateReleaseDeltas(args) {
  const analyzed = await analyzeReleaseDeltas(args);
  await persistReleaseDeltas(args.releaseId, analyzed.pendingInserts);
  return analyzed;
}

async function listReleaseDeltas(releaseId) {
  const rows = await queryAll(
    `SELECT rd.signal_id, rd.baseline_release_id, rd.baseline_value, rd.current_value, rd.max_allowed_drop,
            rd.drop_amount, rd.passed, rd.computed_at, br.version AS baseline_version
     FROM release_deltas rd
     LEFT JOIN releases br ON br.id = rd.baseline_release_id
     WHERE rd.release_id = ?
     ORDER BY rd.signal_id ASC`,
    [releaseId]
  );
  return rows.map((r) => ({
    signal_id: r.signal_id,
    baseline_release_id: r.baseline_release_id,
    baseline_version: r.baseline_version || null,
    baseline_value: r.baseline_value,
    current_value: r.current_value,
    max_allowed_drop: r.max_allowed_drop,
    drop_amount: r.drop_amount,
    passed: r.passed === 1,
    computed_at: r.computed_at,
    no_baseline: r.baseline_value == null && r.drop_amount == null && r.passed === 1
  }));
}

module.exports = {
  analyzeReleaseDeltas,
  persistReleaseDeltas,
  evaluateReleaseDeltas,
  listReleaseDeltas,
  findBaselineRelease,
  maxAllowedDrop
};
