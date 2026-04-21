"use strict";

/**
 * baselineEngine.js
 * Computes robust release signal baselines to replace fragile "last certified" logic.
 * Strategies: last_certified (legacy), median_n, trimmed_mean_n, pinned_golden.
 *
 * Also computes baseline health score to detect baseline creep.
 */

const { queryOne, queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");

const DEFAULT_STRATEGY = "median_n";
const DEFAULT_WINDOW_N = 5;

/** Get or create a baseline policy for a workspace. */
async function getBaselinePolicy(workspaceId) {
  const row = await queryOne("SELECT * FROM baseline_policies WHERE workspace_id = ?", [workspaceId]);
  if (row) return row;
  const ts = nowIso();
  await run(
    `
    INSERT INTO baseline_policies (workspace_id, strategy, window_n, pinned_release_id, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?)
    ON CONFLICT(workspace_id) DO NOTHING
  `,
    [workspaceId, DEFAULT_STRATEGY, DEFAULT_WINDOW_N, ts, ts]
  );
  return queryOne("SELECT * FROM baseline_policies WHERE workspace_id = ?", [workspaceId]);
}

/** Update baseline policy for a workspace. */
async function setBaselinePolicy(workspaceId, { strategy, window_n, pinned_release_id }) {
  const allowed = new Set(["last_certified", "median_n", "trimmed_mean_n", "pinned_golden"]);
  if (!allowed.has(strategy)) throw new Error(`Unknown baseline strategy: ${strategy}`);
  const ts = nowIso();
  await run(
    `
    INSERT INTO baseline_policies (workspace_id, strategy, window_n, pinned_release_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      strategy = excluded.strategy,
      window_n = excluded.window_n,
      pinned_release_id = excluded.pinned_release_id,
      updated_at = excluded.updated_at
  `,
    [workspaceId, strategy, window_n ?? DEFAULT_WINDOW_N, pinned_release_id ?? null, ts, ts]
  );
}

/** Fetch N most recent certified releases for a workspace (excluding current). */
async function getCertifiedReleaseSignals(workspaceId, currentReleaseId, n) {
  const releases = await queryAll(
    `
    SELECT r.id FROM releases r
    WHERE r.workspace_id = ?
      AND r.id != ?
      AND r.status IN ('CERTIFIED', 'CERTIFIED_WITH_OVERRIDE')
      AND r.verdict_issued_at IS NOT NULL
    ORDER BY r.verdict_issued_at::timestamptz DESC
    LIMIT ?
  `,
    [workspaceId, currentReleaseId, n]
  );

  if (!releases.length) return [];

  const out = [];
  for (const rel of releases) {
    const signals = await queryAll("SELECT signal_id, value FROM signals WHERE release_id = ? ORDER BY id ASC", [rel.id]);
    const map = {};
    for (const s of signals) map[s.signal_id] = s.value;
    out.push({ release_id: rel.id, signals: map });
  }
  return out;
}

/** Compute median of an array. */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Trimmed mean: drop top and bottom trimPct fraction before averaging. */
function trimmedMean(values, trimPct = 0.1) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * trimPct);
  const trimmed = sorted.slice(cut, sorted.length - cut || undefined);
  if (!trimmed.length) return sorted[Math.floor(sorted.length / 2)];
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

/**
 * Compute the baseline signal map for a release using the workspace's configured strategy.
 * Returns { strategy, baseline_release_ids, signals: { signal_id: value }, health }.
 */
async function computeBaseline(workspaceId, currentReleaseId) {
  const policy = await getBaselinePolicy(workspaceId);
  const { strategy, window_n, pinned_release_id } = policy;

  if (strategy === "pinned_golden" && pinned_release_id) {
    const pinnedSignals = await queryAll(
      "SELECT signal_id, value FROM signals WHERE release_id = ? ORDER BY id ASC",
      [pinned_release_id]
    );
    if (pinnedSignals.length) {
      const signals = {};
      for (const s of pinnedSignals) signals[s.signal_id] = s.value;
      return {
        strategy,
        baseline_release_ids: [pinned_release_id],
        signals,
        health: scoreBaselineHealth([{ release_id: pinned_release_id, signals }])
      };
    }
  }

  if (strategy === "last_certified") {
    const last = await queryOne(
      `
      SELECT id FROM releases
      WHERE workspace_id = ? AND id != ? AND status IN ('CERTIFIED','CERTIFIED_WITH_OVERRIDE')
        AND verdict_issued_at IS NOT NULL
      ORDER BY verdict_issued_at::timestamptz DESC LIMIT 1
    `,
      [workspaceId, currentReleaseId]
    );
    if (!last) return { strategy, baseline_release_ids: [], signals: {}, health: { score: 0, reason: "no_certified_baseline" } };
    const sigs = await queryAll("SELECT signal_id, value FROM signals WHERE release_id = ? ORDER BY id ASC", [last.id]);
    const signals = {};
    for (const s of sigs) signals[s.signal_id] = s.value;
    return {
      strategy,
      baseline_release_ids: [last.id],
      signals,
      health: scoreBaselineHealth([{ release_id: last.id, signals }])
    };
  }

  const n = Math.max(2, Math.min(20, window_n ?? DEFAULT_WINDOW_N));
  const certifiedReleases = await getCertifiedReleaseSignals(workspaceId, currentReleaseId, n);
  if (!certifiedReleases.length) {
    return { strategy, baseline_release_ids: [], signals: {}, health: { score: 0, reason: "no_certified_baseline" } };
  }

  const allSignalIds = new Set();
  for (const rel of certifiedReleases) Object.keys(rel.signals).forEach((k) => allSignalIds.add(k));

  const signals = {};
  for (const signalId of allSignalIds) {
    const values = certifiedReleases
      .map((r) => r.signals[signalId])
      .filter((v) => v != null && Number.isFinite(v));
    if (!values.length) continue;
    signals[signalId] = strategy === "trimmed_mean_n" ? trimmedMean(values) : median(values);
  }

  return {
    strategy,
    window_used: certifiedReleases.length,
    baseline_release_ids: certifiedReleases.map((r) => r.release_id),
    signals,
    health: scoreBaselineHealth(certifiedReleases)
  };
}

function scoreBaselineHealth(certifiedReleases) {
  if (!certifiedReleases.length) return { score: 0, reason: "no_baseline_releases" };
  if (certifiedReleases.length === 1) return { score: 0.5, reason: "single_release_baseline", detail: "narrow_window" };
  const coverageScore = Math.min(1, certifiedReleases.length / 5);
  return {
    score: Math.round(coverageScore * 100) / 100,
    reason: coverageScore >= 0.8 ? "healthy" : coverageScore >= 0.4 ? "moderate" : "weak",
    release_count: certifiedReleases.length
  };
}

module.exports = { getBaselinePolicy, setBaselinePolicy, computeBaseline, scoreBaselineHealth };
