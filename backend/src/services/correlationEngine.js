"use strict";

/**
 * correlationEngine.js
 * Pairwise Pearson correlation + failure mode classification.
 */

const { queryAll, transaction } = require("../database");
const { nowIso } = require("../lib/time");

const FAILURE_MODE_RULES = [
  {
    id: "ai_quality_regression",
    label: "AI Quality Regression",
    description: "Core AI evaluation metrics dropped below acceptable thresholds.",
    signals: ["accuracy", "relevance", "hallucination", "tone", "safety"],
    minMatch: 2
  },
  {
    id: "safety_breach",
    label: "Safety / Alignment Breach",
    description: "Safety or hallucination signals indicate unacceptable model risk.",
    signals: ["safety", "hallucination"],
    minMatch: 1,
    hard: true
  },
  {
    id: "performance_degradation",
    label: "Performance Degradation",
    description: "Latency and/or throughput signals exceed acceptable bounds.",
    signals: ["p95latency", "p99latency", "startup", "screenload", "fps"],
    minMatch: 2
  },
  {
    id: "stability_failure",
    label: "Stability Failure",
    description: "Crash, error, or OOM rates exceed allowed maximums.",
    signals: ["crashrate", "anrrate", "errorrate", "oomrate", "jserrors", "errorunderload"],
    minMatch: 2
  },
  {
    id: "test_coverage_gap",
    label: "Test Coverage Gap",
    description: "Smoke or regression test pass rates are insufficient.",
    signals: ["smoke", "e2e_regression", "manual_qa_pct"],
    minMatch: 1
  },
  {
    id: "recovery_sla_miss",
    label: "Recovery SLA Miss",
    description: "Recovery or latency under load exceeds SLA threshold.",
    signals: ["recovery", "errorunderload", "p99latency"],
    minMatch: 2
  }
];

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0,
    dx2 = 0,
    dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : Math.max(-1, Math.min(1, num / denom));
}

const UPSERT_CORR_SQL = `
  INSERT INTO signal_correlations (workspace_id, signal_a, signal_b, correlation, sample_count, computed_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id, signal_a, signal_b) DO UPDATE SET
    correlation  = excluded.correlation,
    sample_count = excluded.sample_count,
    computed_at  = excluded.computed_at
`;

const UPSERT_FM_SQL = `
  INSERT INTO failure_mode_classifications
    (release_id, workspace_id, failure_mode, confidence, signals_json, computed_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(release_id, failure_mode) DO UPDATE SET
    confidence   = excluded.confidence,
    signals_json = excluded.signals_json,
    computed_at  = excluded.computed_at
`;

async function computeAndPersistCorrelations(workspaceId, windowN = 20) {
  const certReleases = await queryAll(
    `
    SELECT id FROM releases
    WHERE workspace_id = ? AND status IN ('CERTIFIED','CERTIFIED_WITH_OVERRIDE')
      AND verdict_issued_at IS NOT NULL
    ORDER BY verdict_issued_at::timestamptz DESC
    LIMIT ?
  `,
    [workspaceId, windowN]
  );

  if (certReleases.length < 3) return { computed: 0, reason: "insufficient_certified_releases" };

  const signalMap = {};
  for (const rel of certReleases) {
    const sigs = await queryAll("SELECT signal_id, value FROM signals WHERE release_id = ? ORDER BY id ASC", [rel.id]);
    const seen = {};
    for (const s of sigs) seen[s.signal_id] = s.value;
    for (const [sid, val] of Object.entries(seen)) {
      if (!signalMap[sid]) signalMap[sid] = [];
      signalMap[sid].push({ relIdx: certReleases.indexOf(rel), val });
    }
  }

  const signalIds = Object.keys(signalMap);
  const pairs = [];
  for (let i = 0; i < signalIds.length; i++) {
    for (let j = i + 1; j < signalIds.length; j++) {
      const a = signalIds[i],
        b = signalIds[j];
      const aVals = signalMap[a],
        bVals = signalMap[b];
      const aMap = new Map(aVals.map((v) => [v.relIdx, v.val]));
      const bMap = new Map(bVals.map((v) => [v.relIdx, v.val]));
      const shared = [...aMap.keys()].filter((k) => bMap.has(k));
      if (shared.length < 3) continue;
      const xs = shared.map((k) => aMap.get(k));
      const ys = shared.map((k) => bMap.get(k));
      const r = pearson(xs, ys);
      if (r !== null) pairs.push({ a, b, r, n: shared.length });
    }
  }

  const now = nowIso();
  if (pairs.length === 0) return { computed: 0, release_window: certReleases.length };

  await transaction(async (tx) => {
    for (const p of pairs) {
      await tx.run(UPSERT_CORR_SQL, [workspaceId, p.a, p.b, Math.round(p.r * 1000) / 1000, p.n, now]);
    }
  });

  return { computed: pairs.length, release_window: certReleases.length };
}

async function getCorrelations(workspaceId, minAbs = 0.3) {
  return queryAll(
    `
    SELECT signal_a, signal_b, correlation, sample_count, computed_at
    FROM signal_correlations
    WHERE workspace_id = ? AND ABS(correlation) >= ?
    ORDER BY ABS(correlation) DESC
  `,
    [workspaceId, minAbs]
  );
}

async function classifyFailureModes(releaseId, workspaceId, failedSignalIds) {
  const failed = new Set((failedSignalIds || []).map(String));
  const now = nowIso();
  const classifications = [];

  for (const rule of FAILURE_MODE_RULES) {
    const matchedSignals = rule.signals.filter((s) => failed.has(s));
    if (matchedSignals.length < rule.minMatch) continue;

    const rawConf = matchedSignals.length / rule.signals.length;
    const confidence = rule.hard ? Math.min(1, rawConf + 0.3) : rawConf;

    classifications.push({
      failure_mode: rule.id,
      label: rule.label,
      description: rule.description,
      confidence: Math.round(confidence * 100) / 100,
      matched_signals: matchedSignals,
      hard: !!rule.hard
    });
  }

  if (classifications.length === 0) return [];

  await transaction(async (tx) => {
    for (const c of classifications) {
      await tx.run(UPSERT_FM_SQL, [
        releaseId,
        workspaceId,
        c.failure_mode,
        c.confidence,
        JSON.stringify(c.matched_signals),
        now
      ]);
    }
  });

  return classifications.sort((a, b) => b.confidence - a.confidence);
}

async function getFailureModes(releaseId) {
  const rows = await queryAll(
    `
    SELECT failure_mode, confidence, signals_json, computed_at
    FROM failure_mode_classifications
    WHERE release_id = ?
    ORDER BY confidence DESC
  `,
    [releaseId]
  );
  return rows.map((r) => ({
    failure_mode: r.failure_mode,
    confidence: r.confidence,
    signals: JSON.parse(r.signals_json || "[]"),
    computed_at: r.computed_at,
    label: FAILURE_MODE_RULES.find((x) => x.id === r.failure_mode)?.label || r.failure_mode,
    description: FAILURE_MODE_RULES.find((x) => x.id === r.failure_mode)?.description || ""
  }));
}

async function getFailureModeTrends(workspaceId, _limit = 30) {
  const rows = await queryAll(
    `
    SELECT f.failure_mode, COUNT(*) as count, MAX(f.computed_at) as last_seen
    FROM failure_mode_classifications f
    WHERE f.workspace_id = ?
    GROUP BY f.failure_mode
    ORDER BY count DESC
  `,
    [workspaceId]
  );

  return rows.map((r) => ({
    failure_mode: r.failure_mode,
    label: FAILURE_MODE_RULES.find((x) => x.id === r.failure_mode)?.label || r.failure_mode,
    description: FAILURE_MODE_RULES.find((x) => x.id === r.failure_mode)?.description || "",
    count: r.count,
    last_seen: r.last_seen
  }));
}

module.exports = {
  computeAndPersistCorrelations,
  getCorrelations,
  classifyFailureModes,
  getFailureModes,
  getFailureModeTrends,
  FAILURE_MODE_RULES
};
