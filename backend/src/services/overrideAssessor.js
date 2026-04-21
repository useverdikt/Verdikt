"use strict";

/**
 * overrideAssessor.js
 *
 * Evaluates the quality of an override justification. Returns a structured
 * assessment (STRONG / ADEQUATE / WEAK) with a score, flags, and a summary.
 * Entirely deterministic — no LLM, no network calls.
 *
 * Extracted from domain.js.
 */

const { queryOne } = require("../database");
const { nowIso } = require("../lib/time");

async function assessOverrideJustification({ justification, metadata, workspaceId, regression_signals = [] }) {
  const text = String(justification || "").trim();
  const impact = String(metadata?.impact_summary || "").trim();
  const mitigation = String(metadata?.mitigation_plan || "").trim();
  const due = String(metadata?.follow_up_due_date || "").trim();
  const regSet = new Set(Array.isArray(regression_signals) ? regression_signals.map(String) : []);

  let score = 50;
  if (text.length >= 120) score += 12;
  if (impact.length >= 20) score += 12;
  if (mitigation.length >= 20) score += 12;
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) score += 8;
  if (/\b(rollback|monitor|mitigat|owner|due|alert)\b/i.test(text + " " + mitigation)) score += 6;
  if (regSet.size) {
    if (/\b(baseline|regress|eval|metric|accuracy|safety|hallucination|delta)\b/i.test(text)) score += 6;
    if (regSet.size >= 2 && text.length < 160) score -= 6;
  }

  const recentRow = await queryOne(
    `SELECT COUNT(*) as c
       FROM audit_events
       WHERE workspace_id = ? AND event_type = 'OVERRIDE_APPROVED' AND created_at::timestamptz >= ?::timestamptz`,
    [workspaceId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()]
  );
  const recentOverrides = recentRow?.c ?? 0;
  if (recentOverrides >= 5) score -= 4;

  score = Math.max(0, Math.min(100, score));
  const quality = score >= 80 ? "STRONG" : score >= 65 ? "ADEQUATE" : "WEAK";

  const flags = [];
  if (text.length < 120) flags.push("justification_too_brief");
  if (!/\b(owner|team|lead|vp|cto)\b/i.test(text + " " + mitigation)) flags.push("owner_not_explicit");
  if (!/\b(hour|day|week|sprint|\d{4}-\d{2}-\d{2})\b/i.test(text + " " + due)) flags.push("timeline_not_explicit");
  if (regSet.size && !/\b(baseline|regress|eval|metric|delta|acceptable|risk)\b/i.test(text + " " + mitigation)) {
    flags.push("regression_not_addressed");
  }

  return {
    source: "deterministic_assistive_v1",
    model: "deterministic_assistive_v1",
    prompt_version: "deterministic_v1",
    generated_at: nowIso(),
    quality,
    confidence: 0.74,
    score,
    flags,
    summary:
      quality === "STRONG"
        ? "Override rationale includes clear impact, mitigation, and follow-up timing."
        : quality === "ADEQUATE"
        ? "Override rationale is acceptable but could be more specific on ownership and timing."
        : "Override rationale is weak and should be strengthened before relying on this decision record."
  };
}

module.exports = { assessOverrideJustification };
