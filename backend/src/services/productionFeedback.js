"use strict";

/**
 * productionFeedback.js — post-deployment observations and alignment.
 */

const { queryOne, queryAll, run, transaction } = require("../database");
const { nowIso } = require("../lib/time");

const OUTCOME_CRITERIA = {
  error_rate: [
    { threshold: 5, label: "Error rate > 5%", outcome: "INCIDENT" },
    { threshold: 1, label: "Error rate > 1%", outcome: "DEGRADED" }
  ],
  errorRate: [
    { threshold: 5, label: "Error rate > 5%", outcome: "INCIDENT" },
    { threshold: 1, label: "Error rate > 1%", outcome: "DEGRADED" }
  ],
  p95latency: [
    { threshold: 5000, label: "P95 latency > 5000ms", outcome: "INCIDENT" },
    { threshold: 2000, label: "P95 latency > 2000ms", outcome: "DEGRADED" }
  ],
  p95: [
    { threshold: 5000, label: "P95 latency > 5000ms", outcome: "INCIDENT" },
    { threshold: 2000, label: "P95 latency > 2000ms", outcome: "DEGRADED" }
  ],
  accuracy: [
    { threshold: 70, label: "Accuracy < 70%", outcome: "INCIDENT", direction: "below" },
    { threshold: 80, label: "Accuracy < 80%", outcome: "DEGRADED", direction: "below" }
  ],
  hallucination: [
    { threshold: 70, label: "Hallucination score < 70%", outcome: "INCIDENT", direction: "below" },
    { threshold: 80, label: "Hallucination score < 80%", outcome: "DEGRADED", direction: "below" }
  ],
  safety: [
    { threshold: 80, label: "Safety score < 80%", outcome: "INCIDENT", direction: "below" },
    { threshold: 88, label: "Safety score < 88%", outcome: "DEGRADED", direction: "below" }
  ],
  vcs_reverts: [{ threshold: 0, label: "Revert commit detected post-deploy", outcome: "INCIDENT" }],
  vcs_hotfixes: [
    { threshold: 1, label: "Multiple hotfix commits post-deploy", outcome: "INCIDENT" },
    { threshold: 0, label: "Hotfix commit detected post-deploy", outcome: "DEGRADED" }
  ],
  vcs_incident_prs: [{ threshold: 0, label: "Incident-labelled PR opened post-deploy", outcome: "INCIDENT" }],
  vcs_healthy: []
};

const INSERT_OBS_SQL = `
  INSERT INTO production_observations
    (release_id, workspace_id, signal_name, value, observed_at, source, idempotency_key, metadata_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

async function ingestProductionSignals(releaseId, workspaceId, signals, opts = {}) {
  const { source = "webhook", idempotencyKey = null, metadata = null } = opts;
  const now = nowIso();
  const metaJson = metadata ? JSON.stringify(metadata) : null;

  const inserted = [];
  const duplicates = [];
  const errors = [];

  await transaction(async (tx) => {
    for (const [signalName, value] of Object.entries(signals)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`${signalName}: value must be a finite number`);
        continue;
      }
      if (idempotencyKey) {
        const existing = await tx.queryOne(
          "SELECT id FROM production_observations WHERE release_id = ? AND signal_name = ? AND idempotency_key = ? LIMIT 1",
          [releaseId, signalName, idempotencyKey]
        );
        if (existing) {
          duplicates.push(signalName);
          continue;
        }
      }
      try {
        await tx.run(INSERT_OBS_SQL, [releaseId, workspaceId, signalName, value, now, source, idempotencyKey, metaJson, now]);
        inserted.push(signalName);
      } catch (err) {
        if (err.message?.includes("UNIQUE") || err.message?.includes("duplicate")) duplicates.push(signalName);
        else errors.push(`${signalName}: ${err.message}`);
      }
    }
  });

  if (inserted.length > 0) {
    try {
      await computeOutcomeAlignment(releaseId, workspaceId);
    } catch (_) {}
    try {
      await computeProductionAdjustment(workspaceId);
    } catch (_) {}
  }

  return { inserted, duplicates, errors };
}

function deriveActualOutcome(postMap) {
  const triggered = [];
  const outcomes = [];

  for (const [signalName, criteriaList] of Object.entries(OUTCOME_CRITERIA)) {
    const value = postMap[signalName];
    if (value == null || !Number.isFinite(value)) continue;

    for (const rule of criteriaList) {
      const breached = rule.direction === "below" ? value < rule.threshold : value > rule.threshold;

      if (breached) {
        triggered.push({
          signal: signalName,
          value,
          threshold: rule.threshold,
          label: rule.label,
          outcome: rule.outcome,
          direction: rule.direction ?? "above"
        });
        outcomes.push(rule.outcome);
        break;
      }
    }
  }

  let outcome;
  if (outcomes.includes("INCIDENT")) outcome = "INCIDENT";
  else if (outcomes.includes("DEGRADED")) outcome = "DEGRADED";
  else if (Object.keys(postMap).length > 0) outcome = "HEALTHY";
  else outcome = "UNKNOWN";

  return { outcome, criteria_triggers: triggered };
}

async function computeOutcomeAlignment(releaseId, workspaceId) {
  const release = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
  if (!release) return null;

  const intel = await queryOne("SELECT decision_json FROM release_intelligence WHERE release_id = ?", [releaseId]);
  let recommendedVerdict = null;
  if (intel?.decision_json) {
    try {
      recommendedVerdict = JSON.parse(intel.decision_json).recommended_verdict || null;
    } catch (_) {}
  }

  const preRows = await queryAll("SELECT signal_id, value FROM signals WHERE release_id = ? ORDER BY id ASC", [releaseId]);
  const preMap = {};
  for (const r of preRows) preMap[r.signal_id] = r.value;

  const postRows = await queryAll(
    "SELECT signal_name, value FROM production_observations WHERE release_id = ? ORDER BY id ASC",
    [releaseId]
  );
  const postMap = {};
  for (const r of postRows) postMap[r.signal_name] = r.value;

  if (Object.keys(postMap).length === 0) return null;

  const signalDeltas = {};
  for (const [name, postVal] of Object.entries(postMap)) {
    const preVal = preMap[name] ?? null;
    const delta = preVal != null ? postVal - preVal : null;
    const deltaPct = preVal != null && preVal !== 0 ? ((postVal - preVal) / Math.abs(preVal)) * 100 : null;
    signalDeltas[name] = { pre: preVal, post: postVal, delta, delta_pct: deltaPct };
  }

  const { outcome: actualOutcome, criteria_triggers } = deriveActualOutcome(postMap);
  const alignment = deriveAlignment(recommendedVerdict, actualOutcome);

  const overBlockSuggestions =
    alignment === "OVER_BLOCK"
      ? await deriveOverBlockSuggestions(releaseId, workspaceId, preMap, recommendedVerdict)
      : [];

  const ts = nowIso();
  await run(
    `
    INSERT INTO outcome_alignments
      (release_id, workspace_id, recommended_verdict, actual_outcome, alignment,
       signal_deltas_json, outcome_criteria_json, over_block_suggestions_json, computed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(release_id) DO UPDATE SET
      actual_outcome              = excluded.actual_outcome,
      alignment                   = excluded.alignment,
      signal_deltas_json          = excluded.signal_deltas_json,
      outcome_criteria_json       = excluded.outcome_criteria_json,
      over_block_suggestions_json = excluded.over_block_suggestions_json,
      updated_at                  = excluded.updated_at
  `,
    [
      releaseId,
      workspaceId,
      recommendedVerdict,
      actualOutcome,
      alignment,
      JSON.stringify(signalDeltas),
      JSON.stringify(criteria_triggers),
      JSON.stringify(overBlockSuggestions),
      ts,
      ts
    ]
  );

  return { recommendedVerdict, actualOutcome, alignment, signalDeltas, criteria_triggers, overBlockSuggestions };
}

function deriveAlignment(recommendedVerdict, actualOutcome) {
  if (!recommendedVerdict || actualOutcome === "UNKNOWN") return "UNKNOWN";
  const predictedSafe = ["CERTIFIED", "CERTIFIED_WITH_RISK"].includes(recommendedVerdict);
  const predictedRisky = ["UNCERTIFIED", "UNCERTIFIED_NOISY"].includes(recommendedVerdict);
  const actualHealthy = actualOutcome === "HEALTHY";
  const actualBad = ["DEGRADED", "INCIDENT"].includes(actualOutcome);

  if (predictedSafe && actualHealthy) return "CORRECT";
  if (predictedRisky && actualBad) return "CORRECT";
  if (predictedSafe && actualBad) return "MISS";
  if (predictedRisky && actualHealthy) return "OVER_BLOCK";
  return "UNKNOWN";
}

async function deriveOverBlockSuggestions(releaseId, workspaceId, preSignalMap, _recommendedVerdict) {
  const threshRows = await queryAll("SELECT signal_id, min_value, max_value FROM thresholds WHERE workspace_id = ?", [
    workspaceId
  ]);
  const threshMap = {};
  for (const r of threshRows) threshMap[r.signal_id] = { min: r.min_value, max: r.max_value };

  const suggestions = [];

  for (const [signalId, threshold] of Object.entries(threshMap)) {
    const value = preSignalMap[signalId];
    if (value == null) continue;

    if (threshold.min != null && value < threshold.min) {
      const gap = threshold.min - value;
      const suggestedMin = +(threshold.min * 0.95).toFixed(2);
      suggestions.push({
        signal_id: signalId,
        direction: "lower_min",
        current_threshold: threshold.min,
        suggested_threshold: suggestedMin,
        pre_release_value: value,
        gap,
        rationale: `${signalId} was ${value.toFixed(1)}, only ${gap.toFixed(1)} below the min threshold of ${threshold.min}. ` +
          `Production was healthy — consider lowering the minimum to ${suggestedMin} (−5%).`
      });
    }
    if (threshold.max != null && value > threshold.max) {
      const gap = value - threshold.max;
      const suggestedMax = +(threshold.max * 1.05).toFixed(2);
      suggestions.push({
        signal_id: signalId,
        direction: "raise_max",
        current_threshold: threshold.max,
        suggested_threshold: suggestedMax,
        pre_release_value: value,
        gap,
        rationale: `${signalId} was ${value.toFixed(1)}, only ${gap.toFixed(1)} above the max threshold of ${threshold.max}. ` +
          `Production was healthy — consider raising the maximum to ${suggestedMax} (+5%).`
      });
    }
  }

  return suggestions;
}

async function computeProductionAdjustment(workspaceId) {
  const alignments = await queryAll(
    `
    SELECT alignment, signal_deltas_json
    FROM outcome_alignments
    WHERE workspace_id = ?
    ORDER BY computed_at DESC
    LIMIT 20
  `,
    [workspaceId]
  );

  const total = alignments.length;
  const correct = alignments.filter((a) => a.alignment === "CORRECT").length;
  const misses = alignments.filter((a) => a.alignment === "MISS").length;
  const overBlocks = alignments.filter((a) => a.alignment === "OVER_BLOCK").length;

  const missRate = total > 0 ? misses / total : 0;
  const overBlockRate = total > 0 ? overBlocks / total : 0;
  const correctRate = total > 0 ? correct / total : 0;

  let modifier = 0;
  if (total >= 3) {
    modifier -= Math.round(missRate * 20);
    modifier -= Math.round(overBlockRate * 8);
    modifier += Math.round(correctRate * 8);
    modifier = Math.max(-20, Math.min(10, modifier));
  }

  const driftAccum = {};
  const driftCount = {};
  for (const a of alignments) {
    if (!a.signal_deltas_json) continue;
    try {
      for (const [sig, d] of Object.entries(JSON.parse(a.signal_deltas_json))) {
        if (d.delta_pct == null) continue;
        driftAccum[sig] = (driftAccum[sig] || 0) + d.delta_pct;
        driftCount[sig] = (driftCount[sig] || 0) + 1;
      }
    } catch (_) {}
  }
  const signalDrift = Object.fromEntries(
    Object.entries(driftAccum).map(([sig, sum]) => [sig, +(sum / driftCount[sig]).toFixed(2)])
  );

  const ts = nowIso();
  await run(
    `
    INSERT INTO production_adjustment_cache
      (workspace_id, computed_at, miss_rate_pct, over_block_rate_pct, signal_drift_json, confidence_modifier, sample_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      computed_at         = excluded.computed_at,
      miss_rate_pct       = excluded.miss_rate_pct,
      over_block_rate_pct = excluded.over_block_rate_pct,
      signal_drift_json   = excluded.signal_drift_json,
      confidence_modifier = excluded.confidence_modifier,
      sample_count        = excluded.sample_count
  `,
    [workspaceId, ts, missRate * 100, overBlockRate * 100, JSON.stringify(signalDrift), modifier, total]
  );

  return { miss_rate_pct: missRate * 100, over_block_rate_pct: overBlockRate * 100, confidence_modifier: modifier, sample_count: total };
}

async function getProductionAdjustment(workspaceId) {
  const row = await queryOne("SELECT * FROM production_adjustment_cache WHERE workspace_id = ?", [workspaceId]);
  if (!row || row.sample_count < 3) return null;
  return {
    confidence_modifier: row.confidence_modifier,
    miss_rate_pct: row.miss_rate_pct,
    over_block_rate_pct: row.over_block_rate_pct,
    signal_drift: row.signal_drift_json ? JSON.parse(row.signal_drift_json) : {},
    sample_count: row.sample_count,
    computed_at: row.computed_at
  };
}

async function getWorkspaceProductionHealth(workspaceId) {
  const alignments = await queryAll(
    `
    SELECT oa.*, r.version, r.status AS release_status, r.verdict_issued_at
    FROM outcome_alignments oa
    JOIN releases r ON r.id = oa.release_id
    WHERE oa.workspace_id = ?
    ORDER BY oa.computed_at DESC
    LIMIT 50
  `,
    [workspaceId]
  );

  const total = alignments.length;
  const correct = alignments.filter((a) => a.alignment === "CORRECT").length;
  const misses = alignments.filter((a) => a.alignment === "MISS").length;
  const overBlocks = alignments.filter((a) => a.alignment === "OVER_BLOCK").length;
  const unknown = alignments.filter((a) => a.alignment === "UNKNOWN").length;

  const predictionAccuracy = total > 0 ? Math.round((correct / total) * 100) : null;

  const deltaAccum = {};
  const deltaCount = {};
  for (const a of alignments) {
    if (!a.signal_deltas_json) continue;
    try {
      for (const [sig, d] of Object.entries(JSON.parse(a.signal_deltas_json))) {
        if (d.delta_pct == null) continue;
        deltaAccum[sig] = (deltaAccum[sig] || 0) + d.delta_pct;
        deltaCount[sig] = (deltaCount[sig] || 0) + 1;
      }
    } catch (_) {}
  }
  const avgSignalDrifts = Object.fromEntries(
    Object.entries(deltaAccum).map(([sig, sum]) => [sig, +(sum / deltaCount[sig]).toFixed(2)])
  );

  const allOverBlockSuggestions = [];
  for (const a of alignments) {
    if (a.alignment !== "OVER_BLOCK" || !a.over_block_suggestions_json) continue;
    try {
      const sug = JSON.parse(a.over_block_suggestions_json);
      for (const s of sug) allOverBlockSuggestions.push({ ...s, release_id: a.release_id, version: a.version });
    } catch (_) {}
  }

  const seenSignals = new Set();
  const deduped = [];
  for (const s of allOverBlockSuggestions) {
    if (!seenSignals.has(s.signal_id)) {
      seenSignals.add(s.signal_id);
      deduped.push(s);
    }
  }

  const obsRow = await queryOne("SELECT COUNT(*) AS c FROM production_observations WHERE workspace_id = ?", [workspaceId]);
  const obsCount = obsRow?.c ?? 0;

  const adjustment = await getProductionAdjustment(workspaceId);

  return {
    total_releases_with_feedback: total,
    prediction_accuracy_pct: predictionAccuracy,
    correct,
    misses,
    over_blocks: overBlocks,
    unknown,
    avg_signal_drifts: avgSignalDrifts,
    total_observations: obsCount,
    production_confidence_modifier: adjustment?.confidence_modifier ?? null,
    over_block_threshold_suggestions: deduped,
    outcome_classification_criteria: OUTCOME_CRITERIA,
    alignments: alignments.map((a) => ({
      release_id: a.release_id,
      version: a.version,
      release_status: a.release_status,
      recommended_verdict: a.recommended_verdict,
      actual_outcome: a.actual_outcome,
      alignment: a.alignment,
      incident_ref: a.incident_ref || null,
      outcome_criteria: a.outcome_criteria_json ? JSON.parse(a.outcome_criteria_json) : [],
      over_block_suggestions: a.over_block_suggestions_json ? JSON.parse(a.over_block_suggestions_json) : [],
      computed_at: a.computed_at,
      signal_deltas: a.signal_deltas_json ? JSON.parse(a.signal_deltas_json) : {}
    }))
  };
}

async function getProductionObservations(releaseId) {
  const rows = await queryAll(
    `
    SELECT signal_name, value, observed_at, source, metadata_json
    FROM production_observations
    WHERE release_id = ?
    ORDER BY observed_at ASC
  `,
    [releaseId]
  );
  return rows.map((r) => ({ ...r, metadata: r.metadata_json ? JSON.parse(r.metadata_json) : null }));
}

async function setIncidentRef(releaseId, workspaceId, incidentRef) {
  const row = await queryOne("SELECT release_id FROM outcome_alignments WHERE release_id = ? AND workspace_id = ?", [
    releaseId,
    workspaceId
  ]);

  if (!row) {
    const ts = nowIso();
    await run(
      `
      INSERT INTO outcome_alignments
        (release_id, workspace_id, recommended_verdict, actual_outcome, alignment,
         signal_deltas_json, incident_ref, computed_at, updated_at)
      VALUES (?, ?, NULL, 'UNKNOWN', 'UNKNOWN', '{}', ?, ?, ?)
    `,
      [releaseId, workspaceId, incidentRef, ts, ts]
    );
  } else {
    await run("UPDATE outcome_alignments SET incident_ref = ?, updated_at = ? WHERE release_id = ?", [
      incidentRef,
      nowIso(),
      releaseId
    ]);
  }
  return { release_id: releaseId, incident_ref: incidentRef };
}

module.exports = {
  ingestProductionSignals,
  computeOutcomeAlignment,
  computeProductionAdjustment,
  getProductionAdjustment,
  getWorkspaceProductionHealth,
  getProductionObservations,
  setIncidentRef,
  OUTCOME_CRITERIA
};
