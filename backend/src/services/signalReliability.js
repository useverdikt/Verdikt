"use strict";

/**
 * signalReliability.js
 */

const { queryAll, transaction } = require("../database");
const { nowIso } = require("../lib/time");

const GRADE_THRESHOLDS = [
  { min: 0.9, grade: "A" },
  { min: 0.75, grade: "B" },
  { min: 0.6, grade: "C" },
  { min: 0.4, grade: "D" },
  { min: 0, grade: "F" }
];

function toGrade(score) {
  for (const t of GRADE_THRESHOLDS) {
    if (score >= t.min) return t.grade;
  }
  return "F";
}

function cv(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

const UPSERT_REL_SQL = `
  INSERT INTO signal_reliability
    (workspace_id, signal_id, computed_at, sample_count, on_time_rate, variance_score, reliability, grade)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id, signal_id) DO UPDATE SET
    computed_at    = excluded.computed_at,
    sample_count   = excluded.sample_count,
    on_time_rate   = excluded.on_time_rate,
    variance_score = excluded.variance_score,
    reliability    = excluded.reliability,
    grade          = excluded.grade
`;

async function computeSignalReliability(workspaceId, windowN = 20) {
  const releases = await queryAll(
    `
    SELECT id FROM releases
    WHERE workspace_id = ?
      AND status IN ('CERTIFIED','CERTIFIED_WITH_OVERRIDE','UNCERTIFIED')
      AND verdict_issued_at IS NOT NULL
    ORDER BY verdict_issued_at::timestamptz DESC
    LIMIT ?
  `,
    [workspaceId, windowN]
  );

  if (releases.length < 2) return [];

  const n = releases.length;
  const releaseSignals = new Map();
  for (const rel of releases) {
    const sigs = await queryAll("SELECT signal_id, value FROM signals WHERE release_id = ? ORDER BY id ASC", [rel.id]);
    const map = {};
    for (const s of sigs) map[s.signal_id] = s.value;
    releaseSignals.set(rel.id, map);
  }

  const allSignalIds = new Set();
  for (const [, map] of releaseSignals) Object.keys(map).forEach((k) => allSignalIds.add(k));

  const now = nowIso();
  const results = [];

  for (const signalId of allSignalIds) {
    const values = [];
    let present = 0;

    for (const rel of releases) {
      const map = releaseSignals.get(rel.id) || {};
      if (map[signalId] != null && Number.isFinite(map[signalId])) {
        values.push(map[signalId]);
        present++;
      }
    }

    const onTimeRate = present / n;
    const varianceScore = values.length >= 2 ? Math.min(1, cv(values)) : 0;
    const stabilityBonus = Math.max(0, 1 - varianceScore * 2);
    const reliability = Math.round((0.7 * onTimeRate + 0.3 * stabilityBonus) * 100) / 100;
    const grade = onTimeRate === 0 ? "F" : toGrade(reliability);

    const entry = {
      signal_id: signalId,
      sample_count: n,
      on_time_rate: Math.round(onTimeRate * 1000) / 1000,
      variance_score: Math.round(varianceScore * 1000) / 1000,
      reliability,
      grade,
      computed_at: now
    };

    results.push(entry);
  }

  await transaction(async (tx) => {
    for (const entry of results) {
      await tx.run(UPSERT_REL_SQL, [
        workspaceId,
        entry.signal_id,
        now,
        n,
        entry.on_time_rate,
        entry.variance_score,
        entry.reliability,
        entry.grade
      ]);
    }
  });

  return results.sort((a, b) => b.reliability - a.reliability);
}

async function getSignalReliability(workspaceId) {
  return queryAll(
    `
    SELECT signal_id, sample_count, on_time_rate, variance_score, reliability, grade, computed_at
    FROM signal_reliability
    WHERE workspace_id = ?
    ORDER BY reliability DESC
  `,
    [workspaceId]
  );
}

async function getReliabilitySummary(workspaceId) {
  const rows = await getSignalReliability(workspaceId);
  const summary = { A: 0, B: 0, C: 0, D: 0, F: 0, unknown: 0 };
  for (const r of rows) summary[r.grade] = (summary[r.grade] || 0) + 1;
  return { grades: summary, total: rows.length, computed_at: rows[0]?.computed_at || null };
}

module.exports = { computeSignalReliability, getSignalReliability, getReliabilitySummary };
