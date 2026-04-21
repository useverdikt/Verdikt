"use strict";

/**
 * thresholdAdvisor.js
 *
 * Analyses historical signal data to suggest threshold tightening or loosening.
 * Entirely read-only against the DB — produces suggestions, never applies them.
 * LLM enrichment of suggestion reasons is delegated to llmAssist.js.
 *
 * Extracted from domain.js.
 */

const { queryAll } = require("../database");
const { getThresholdMap } = require("./workspaceConfig");

// ─── Numeric helpers ──────────────────────────────────────────────────────────

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function round1(v) { return Math.round(v * 10) / 10; }

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

// ─── Main advisor ─────────────────────────────────────────────────────────────

async function buildThresholdSuggestions(workspaceId) {
  const now = Date.now();
  const sixtyDaysAgoIso = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
  const byTime = await queryAll(
    `SELECT id, status, created_at FROM releases
     WHERE workspace_id = ? AND created_at::timestamptz >= ?::timestamptz
     ORDER BY created_at::timestamptz DESC`,
    [workspaceId, sixtyDaysAgoIso]
  );
  const byCount = await queryAll(
    `SELECT id, status, created_at FROM releases
     WHERE workspace_id = ?
     ORDER BY created_at::timestamptz DESC
     LIMIT 20`,
    [workspaceId]
  );
  const selected = byTime.length >= byCount.length ? byTime : byCount;
  const releaseIds = selected.map((r) => r.id);
  const windowMeta = {
    type: byTime.length >= byCount.length ? "60_days" : "20_releases",
    release_count: selected.length
  };

  if (!releaseIds.length) {
    const fallbackSuggestions = [];
    const thresholds = await getThresholdMap(workspaceId);
    for (const [signalId, cfg] of Object.entries(thresholds)) {
      if (cfg.min != null && cfg.min <= 97) {
        fallbackSuggestions.push({
          id: `sug:${workspaceId}:${signalId}:min:fallback`,
          signal_id: signalId,
          direction: "min",
          current: cfg.min,
          suggested: round1(Math.min(100, cfg.min + 1)),
          current_threshold: { min: cfg.min, max: cfg.max },
          suggested_threshold: { min: round1(Math.min(100, cfg.min + 1)), max: cfg.max },
          confidence: 0.32,
          reason: "Insufficient history yet. Starter suggestion based on conservative default tightening.",
          fail_rate: 0,
          basis_window: { type: "fallback_no_history", last_n_releases: 0 }
        });
      } else if (cfg.max != null && cfg.max >= 2) {
        fallbackSuggestions.push({
          id: `sug:${workspaceId}:${signalId}:max:fallback`,
          signal_id: signalId,
          direction: "max",
          current: cfg.max,
          suggested: Math.max(1, Math.round(cfg.max - 1)),
          current_threshold: { min: cfg.min, max: cfg.max },
          suggested_threshold: { min: cfg.min, max: Math.max(1, Math.round(cfg.max - 1)) },
          confidence: 0.32,
          reason: "Insufficient history yet. Starter suggestion based on conservative default tightening.",
          fail_rate: 0,
          basis_window: { type: "fallback_no_history", last_n_releases: 0 }
        });
      }
      if (fallbackSuggestions.length >= 2) break;
    }
    return { window: { ...windowMeta, last_n_releases: 0 }, suggestions: fallbackSuggestions };
  }

  const placeholders = releaseIds.map(() => "?").join(",");
  const signals = await queryAll(
    `SELECT release_id, signal_id, value
     FROM signals
     WHERE release_id IN (${placeholders})`,
    releaseIds
  );
  const bySignal = new Map();
  for (const row of signals) {
    if (!bySignal.has(row.signal_id)) bySignal.set(row.signal_id, []);
    bySignal.get(row.signal_id).push(row.value);
  }

  const thresholdFailReleasesBySignal = new Map();
  const signalEvents = await queryAll(
    `SELECT release_id, details_json
     FROM audit_events
     WHERE workspace_id = ? AND event_type = 'SIGNALS_INGESTED' AND release_id IS NOT NULL
     ORDER BY id DESC
     LIMIT 400`,
    [workspaceId]
  );
  const selectedSet = new Set(releaseIds);
  for (const evt of signalEvents) {
    if (!selectedSet.has(evt.release_id)) continue;
    let details = {};
    try { details = JSON.parse(evt.details_json || "{}"); } catch {}
    const tf = Array.isArray(details.threshold_failed_signals) ? details.threshold_failed_signals : null;
    const rawFailed = Array.isArray(details.failed_signals) ? details.failed_signals : [];
    const failed = tf || rawFailed.filter((f) => f && f.rule !== "required signal missing at evaluation");
    for (const f of failed) {
      if (!f || !f.signal_id) continue;
      if (!thresholdFailReleasesBySignal.has(f.signal_id)) thresholdFailReleasesBySignal.set(f.signal_id, new Set());
      thresholdFailReleasesBySignal.get(f.signal_id).add(evt.release_id);
    }
  }

  const thresholds = await getThresholdMap(workspaceId);
  const suggestions = [];
  for (const [signalId, cfg] of Object.entries(thresholds)) {
    const values = (bySignal.get(signalId) || []).filter((v) => typeof v === "number");
    if (values.length < 8) continue;
    const failReleaseCount = (thresholdFailReleasesBySignal.get(signalId) || new Set()).size;
    const failRate = Math.min(1, failReleaseCount / Math.max(1, selected.length));

    if (cfg.max != null) {
      const p75 = percentile(values, 0.75);
      if (p75 != null && p75 < cfg.max * 0.8) {
        const suggestedMax = Math.max(1, Math.round(p75 * 1.1));
        if (suggestedMax < cfg.max) {
          suggestions.push({
            id: `sug:${workspaceId}:${signalId}:max`,
            signal_id: signalId,
            direction: "max",
            current: cfg.max,
            suggested: suggestedMax,
            current_threshold: { min: cfg.min, max: cfg.max },
            suggested_threshold: { min: cfg.min, max: suggestedMax },
            confidence: clamp01(0.55 + Math.min(0.35, values.length / 80)),
            reason: `Observed p75 is ${Math.round(p75)}. Consider tightening max threshold to ${suggestedMax}.`,
            fail_rate: round1(failRate * 100),
            basis_window: { type: windowMeta.type, last_n_releases: selected.length }
          });
        }
      }
      continue;
    }

    if (cfg.min != null) {
      const p50 = percentile(values, 0.5);
      if (p50 != null && p50 >= cfg.min + 6 && failRate <= 0.15) {
        const suggestedMin = Math.min(100, round1(cfg.min + 3));
        if (suggestedMin > cfg.min) {
          suggestions.push({
            id: `sug:${workspaceId}:${signalId}:min`,
            signal_id: signalId,
            direction: "min",
            current: cfg.min,
            suggested: suggestedMin,
            current_threshold: { min: cfg.min, max: cfg.max },
            suggested_threshold: { min: suggestedMin, max: cfg.max },
            confidence: clamp01(0.5 + Math.min(0.35, values.length / 80)),
            reason: `Recent median is ${round1(p50)} with low fail rate. Consider raising floor to ${suggestedMin}.`,
            fail_rate: round1(failRate * 100),
            basis_window: { type: windowMeta.type, last_n_releases: selected.length }
          });
        }
      }
    }
  }
  suggestions.sort((a, b) => {
    if (a.signal_id === b.signal_id) return a.direction.localeCompare(b.direction);
    return a.signal_id.localeCompare(b.signal_id);
  });
  return { window: { ...windowMeta, last_n_releases: selected.length }, suggestions };
}

module.exports = { buildThresholdSuggestions };
