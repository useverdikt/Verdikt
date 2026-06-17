"use strict";

/**
 * recommendationEngine.js
 *
 * Turns raw verdict data into a structured recommendation:
 *   { recommended_verdict, confidence_score, confidence_level, reasoning, recommendation, suggested_actions }
 *
 * Recommended verdict types (additive layer — does NOT change releases.status):
 *   CERTIFIED              – all signals well above thresholds, high confidence, no known risk patterns
 *   CERTIFIED_WITH_RISK    – passes thresholds but has at-risk signals, pattern history, or reliability gaps
 *   UNCERTIFIED            – fails thresholds, signals are reliable → clear hard stop
 *   UNCERTIFIED_NOISY      – fails thresholds but confidence is LOW (unreliable signals / threshold suspect)
 *   COLLECTING             – not enough signals to decide yet
 *
 * Confidence score: 0–100 integer (maps to HIGH ≥70, MEDIUM 40–69, LOW <40)
 *
 * UNCERTIFIED: gate-health score — share of hard gates still passing (0% = all hard gates
 * failed). Proximity / at-risk penalties affect reasoning only, not the meter.
 * CERTIFIED*: penalty model with floors so borderline passes do not read as 0% trust.
 */

const { queryOne, queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");
const { safeJsonParse } = require("../lib/safeJson");
const { upsertReleaseIntelligence, parseRecommendationBlob } = require("./intelligenceBuilder");

// ─── Grade weights for reliability penalty ────────────────────────────────────
const RELIABILITY_PENALTY = { A: 0, B: 2, C: 6, D: 12, F: 20, unknown: 4 };
const MAX_PROXIMITY_PENALTY = 42;
const MAX_RELIABILITY_PENALTY = 28;
const MAX_FAILURE_MODE_PENALTY = 24;

function isBinaryPassSignal(signalId, value, minFloor) {
  if (minFloor == null || value == null) return false;
  const id = String(signalId || "");
  if (id === "smoke" || id === "e2e_regression") return value >= minFloor;
  if (minFloor >= 99 && value >= minFloor) return true;
  if (minFloor <= 1 && value >= minFloor) return true;
  return false;
}

// ─── Confidence band labels ───────────────────────────────────────────────────
function confidenceLevel(score) {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function isRequiredHardGate(threshold) {
  return threshold?.required === true || threshold?.required === 1;
}

/**
 * Hard-gate outcomes for UNCERTIFIED confidence (failure severity, not proximity noise).
 */
function countHardGateOutcomes(thresholds, signals, failedSignals) {
  const failedSet = new Set(failedSignals.map((f) => f.signal_id));
  let hardTotal = 0;
  let hardFailed = 0;

  for (const [signalId, threshold] of Object.entries(thresholds)) {
    if (!isRequiredHardGate(threshold)) continue;
    const evaluated = signals[signalId] != null || failedSet.has(signalId);
    if (!evaluated) continue;
    hardTotal++;
    if (failedSet.has(signalId)) {
      hardFailed++;
    }
  }

  if (hardTotal === 0 && failedSignals.length > 0) {
    const evaluatedIds = new Set([
      ...Object.keys(signals).filter((id) => signals[id] != null),
      ...failedSignals.map((f) => f.signal_id)
    ]);
    hardTotal = evaluatedIds.size;
    hardFailed = failedSignals.length;
  }

  return { hardTotal, hardFailed };
}

/**
 * UNCERTIFIED confidence = residual hard-gate health (not stacked proximity penalties).
 * One reliable hard-gate miss → materially above 0%; all hard gates failed → 0%.
 */
function computeUncertifiedGateConfidence({
  thresholds,
  signals,
  failedSignals,
  missingRequiredSignals,
  reliabilityMap
}) {
  const { hardTotal, hardFailed } = countHardGateOutcomes(thresholds, signals, failedSignals);
  const failRatio = hardTotal > 0 ? hardFailed / hardTotal : failedSignals.length > 0 ? 1 : 0;

  let score = Math.round(100 * (1 - failRatio));
  score -= missingRequiredSignals.length * 6;

  for (const f of failedSignals) {
    const grade = reliabilityMap[f.signal_id]?.grade;
    if (grade === "C" || grade === "D" || grade === "F") {
      score -= 12;
    }
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Core engine ─────────────────────────────────────────────────────────────

/**
 * Build a full recommendation for a release.
 *
 * @param {object} release   – full release DB row
 * @param {object} ctx       – {
 *   signals: {signal_id: value},      // latest signal map
 *   thresholds: {signal_id: {min,max}},
 *   failedSignals: [],                // from verdict engine
 *   missingRequiredSignals: [],
 *   failureModes: [],                 // from correlationEngine.getFailureModes()
 *   earlyWarning: object|null,        // from earlyWarning.getEarlyWarning()
 *   reliabilityMap: {signal_id: row}, // from signalReliability
 *   overrideAnalytics: object|null,   // from overrideAnalytics
 *   correlations: [],                 // from correlationEngine.getCorrelations()
 * }
 * @returns {object} structured recommendation
 */
function buildRecommendation(release, ctx = {}) {
  const {
    signals = {},
    thresholds = {},
    failedSignals = [],
    missingRequiredSignals = [],
    failureModes = [],
    earlyWarning = null,
    reliabilityMap = {},
    overrideAnalytics = null,
    correlations = [],
    productionAdjustment = null
  } = ctx;

  const baseStatus = release.status; // CERTIFIED | UNCERTIFIED | CERTIFIED_WITH_OVERRIDE | COLLECTING
  const reasoning = [];
  const suggestedActions = [];
  let confidenceScore = 100;

  // Whether the code is already live — "fix and re-run" advice is no longer relevant.
  const env = (release.environment || "").toLowerCase();
  const isProd = env === "prod" || env === "production";
  const isProdBypassed =
    isProd &&
    baseStatus === "UNCERTIFIED" &&
    (release.shipped_without_certification === 1 || release.shipped_without_certification === true);

  // ── 1. Handle COLLECTING state ────────────────────────────────────────────
  if (baseStatus === "COLLECTING") {
    return {
      recommended_verdict: "COLLECTING",
      confidence_score: null,
      confidence_level: null,
      reasoning: ["Release is still in the signal collection window — verdict not yet issued."],
      recommendation: "Wait for all required signals to arrive before evaluating.",
      suggested_actions: ["Monitor the live stream for incoming signals.", "Check early warning panel for at-risk signals."],
      computed_at: nowIso()
    };
  }

  // ── 2. Signal proximity to threshold ─────────────────────────────────────
  // Use tight absolute-point bands so signals comfortably above threshold
  // (e.g. score=95 when floor=90) are NOT flagged — only genuinely close calls.
  // AT_RISK : gap < 3% of threshold value  (e.g. floor=90 → within 2.7 pts = 90–92.7)
  // MONITOR : gap < 5.5% of threshold value (e.g. floor=90 → within 4.95 pts = 90–94.95)
  const atRiskSignals = [];
  let proximityPenalty = 0;
  for (const [signalId, threshold] of Object.entries(thresholds)) {
    if (String(signalId).endsWith("_delta")) continue;
    const value = signals[signalId];
    if (value == null || !Number.isFinite(value)) continue;

    const minFloor = threshold.min;
    const maxCeil = threshold.max;

    if (minFloor != null && value >= minFloor) {
      if (isBinaryPassSignal(signalId, value, minFloor)) continue;

      const gap = value - minFloor;
      const bandAtRisk = minFloor * 0.03;   // 3 % → genuinely at risk
      const bandMonitor = minFloor * 0.055; // 5.5 % → worth noting

      if (gap < bandAtRisk) {
        atRiskSignals.push({ signal_id: signalId, value, threshold: minFloor, gap, band: "3%" });
        proximityPenalty += 12;
        reasoning.push(`**${signalId}** is ${roundN(value, 1)} — only ${roundN(gap, 1)} points above threshold (${minFloor}). At risk of failing on next release.`);
      } else if (gap < bandMonitor) {
        atRiskSignals.push({ signal_id: signalId, value, threshold: minFloor, gap, band: "5%" });
        proximityPenalty += 4;
        reasoning.push(`**${signalId}** is ${roundN(value, 1)} — within ${roundN(gap, 1)} points of threshold floor (${minFloor}). Monitor this trend.`);
      }
    }
    if (maxCeil != null && value <= maxCeil) {
      const gap = maxCeil - value;
      const bandAtRisk = maxCeil * 0.03;
      if (gap < bandAtRisk) {
        atRiskSignals.push({ signal_id: signalId, value, threshold: maxCeil, gap, band: "3%" });
        proximityPenalty += 12;
        reasoning.push(`**${signalId}** is ${roundN(value, 1)} — within ${roundN(gap, 1)} points of threshold ceiling (${maxCeil}).`);
      }
    }
  }
  confidenceScore -= Math.min(MAX_PROXIMITY_PENALTY, proximityPenalty);

  // ── 3. Failed signals ─────────────────────────────────────────────────────
  for (const f of failedSignals) {
    confidenceScore -= 22;
    reasoning.push(`**${f.signal_id}** failed: value ${f.value ?? "missing"} — ${f.rule || "threshold breach"}.`);
  }

  // ── 4. Missing required signals ───────────────────────────────────────────
  if (missingRequiredSignals.length > 0) {
    confidenceScore -= missingRequiredSignals.length * 8;
    reasoning.push(`${missingRequiredSignals.length} required signal(s) missing at verdict: ${missingRequiredSignals.slice(0, 4).join(", ")}${missingRequiredSignals.length > 4 ? "…" : ""}.`);
  }

  // ── 5. Signal reliability penalties (only for signals in this verdict) ───────
  const lowReliabilitySignals = [];
  const verdictRelevantSignals = new Set([
    ...atRiskSignals.map((s) => s.signal_id),
    ...failedSignals.map((f) => f.signal_id),
    ...missingRequiredSignals
  ]);
  let reliabilityPenalty = 0;
  for (const [signalId, rel] of Object.entries(reliabilityMap)) {
    if (!verdictRelevantSignals.has(signalId)) continue;
    const penalty = RELIABILITY_PENALTY[rel.grade] ?? RELIABILITY_PENALTY.unknown;
    if (penalty > 0 && (signals[signalId] != null || failedSignals.some((f) => f.signal_id === signalId))) {
      reliabilityPenalty += penalty;
      if (rel.grade === "C" || rel.grade === "D" || rel.grade === "F") {
        lowReliabilitySignals.push({ signal_id: signalId, grade: rel.grade, on_time_rate: rel.on_time_rate });
        reasoning.push(`**${signalId}** signal reliability is **${rel.grade}** (${Math.round(rel.on_time_rate * 100)}% on-time, ${rel.grade === "F" ? "highly unstable" : "variable"}) — treat this verdict with caution.`);
      }
    }
  }
  confidenceScore -= Math.min(MAX_RELIABILITY_PENALTY, reliabilityPenalty);

  // ── 6. Failure mode pattern history ──────────────────────────────────────
  let failureModePenalty = 0;
  for (const mode of failureModes) {
    if (mode.confidence >= 0.6) {
      failureModePenalty += Math.round(mode.confidence * 14);
      reasoning.push(`Failure mode classified: **${mode.label}** (${Math.round(mode.confidence * 100)}% confidence). This pattern was detected on signals: ${mode.signals.slice(0, 4).join(", ")}.`);
    }
  }
  confidenceScore -= Math.min(MAX_FAILURE_MODE_PENALTY, failureModePenalty);

  // ── 7. Override history on these signals ──────────────────────────────────
  if (overrideAnalytics) {
    const relevantSignalIds = new Set([
      ...failedSignals.map((f) => f.signal_id),
      ...atRiskSignals.map((s) => s.signal_id)
    ]);
    const overriddenSignals = (overrideAnalytics.top_signals || []).filter((s) => relevantSignalIds.has(s.signal_id));
    for (const s of overriddenSignals) {
      if (s.count >= 2) {
        confidenceScore -= Math.min(15, s.count * 4);
        reasoning.push(`**${s.signal_id}** has been overridden ${s.count}× this workspace. High override frequency on this signal may indicate threshold calibration drift.`);
      }
    }
    if (overrideAnalytics.override_rate_pct > 30) {
      confidenceScore -= 8;
      reasoning.push(`Overall workspace override rate is **${overrideAnalytics.override_rate_pct}%** — higher than recommended. Teams may be normalising override approvals.`);
    }
  }

  // ── 8. Correlation-based co-failure risk ──────────────────────────────────
  const failedSet = new Set(failedSignals.map((f) => f.signal_id).concat(atRiskSignals.map((s) => s.signal_id)));
  const strongCorrs = (correlations || []).filter((c) => Math.abs(c.correlation) >= 0.65);
  for (const corr of strongCorrs) {
    const aFailed = failedSet.has(corr.signal_a);
    const bFailed = failedSet.has(corr.signal_b);
    if (aFailed && bFailed) {
      confidenceScore -= 10;
      reasoning.push(`**${corr.signal_a}** and **${corr.signal_b}** are strongly correlated (r=${corr.correlation.toFixed(2)}) and both flagged — this is a known co-failure pattern.`);
    }
  }

  // ── 9. Early warning context ──────────────────────────────────────────────
  if (earlyWarning?.overall_risk === "at_risk") {
    confidenceScore -= 8;
    reasoning.push(`Early warning during collection showed **at_risk** status — some signals were near thresholds before verdict was issued.`);
  } else if (earlyWarning?.overall_risk === "likely_breach" || earlyWarning?.overall_risk === "unstable_sample") {
    confidenceScore -= 14;
    reasoning.push(`Early warning flagged **${earlyWarning.overall_risk}** during collection — results may not be fully representative.`);
  }

  // ── 10. Environment context (staging vs prod tolerance) ───────────────────
  if (env === "dev" || env === "development") {
    confidenceScore = Math.min(100, confidenceScore + 8);
    reasoning.push(`Environment is **development** — higher risk tolerance is acceptable at this stage.`);
  } else if (env === "prod" || env === "production") {
    confidenceScore -= 5;
    reasoning.push(`Environment is **production** — apply stricter caution even for borderline passes.`);
  }

  // ── 11. Production feedback adjustment (self-calibrating) ────────────────
  // If the system has alignment history (≥3 releases), adjust confidence based
  // on historical accuracy so repeated misses lower confidence on future calls.
  let productionAdjustmentNote = null;
  if (productionAdjustment && typeof productionAdjustment.confidence_modifier === "number") {
    const mod = productionAdjustment.confidence_modifier;
    if (mod !== 0) {
      confidenceScore += mod;
      const n = productionAdjustment.sample_count;
      if (mod < -5) {
        productionAdjustmentNote = `Confidence reduced by ${Math.abs(mod)} pts based on production history (${productionAdjustment.miss_rate_pct.toFixed(0)}% miss rate across ${n} past releases). The system has historically over-predicted safety — apply extra caution.`;
        reasoning.push(`**Production track record:** confidence adjusted −${Math.abs(mod)} pts. ${productionAdjustmentNote}`);
      } else if (mod > 3) {
        productionAdjustmentNote = `Confidence boosted by ${mod} pts — this workspace has a strong prediction accuracy record across ${n} past releases.`;
        reasoning.push(`**Production track record:** confidence adjusted +${mod} pts. ${productionAdjustmentNote}`);
      }
    }
    // Surface any drifting signals from production history
    const driftWarnings = Object.entries(productionAdjustment.signal_drift || {})
      .filter(([, pct]) => Math.abs(pct) >= 10)
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
      .slice(0, 3);
    for (const [sig, pct] of driftWarnings) {
      reasoning.push(`**${sig}** historically drifts **${pct > 0 ? "+" : ""}${pct.toFixed(1)}%** post-deployment on average. Factor this into your monitoring thresholds.`);
    }
  }

  // ── 12. Clamp confidence ──────────────────────────────────────────────────
  if (baseStatus === "UNCERTIFIED") {
    confidenceScore = computeUncertifiedGateConfidence({
      thresholds,
      signals,
      failedSignals,
      missingRequiredSignals,
      reliabilityMap
    });
  } else {
    confidenceScore = Math.max(0, Math.min(100, Math.round(confidenceScore)));
    if (
      (baseStatus === "CERTIFIED" || baseStatus === "CERTIFIED_WITH_OVERRIDE") &&
      failedSignals.length === 0 &&
      missingRequiredSignals.length === 0
    ) {
      // Advisory score should not read as "zero trust" when the gate already certified.
      confidenceScore = Math.max(confidenceScore, atRiskSignals.length === 0 ? 72 : 38);
    }
  }
  const level = confidenceLevel(confidenceScore);

  // ── 13. Recommended verdict classification ────────────────────────────────
  let recommendedVerdict;
  if (baseStatus === "CERTIFIED" || baseStatus === "CERTIFIED_WITH_OVERRIDE") {
    if (atRiskSignals.length === 0 && failureModes.length === 0 && confidenceScore >= 70) {
      recommendedVerdict = "CERTIFIED";
    } else {
      recommendedVerdict = "CERTIFIED_WITH_RISK";
    }
  } else if (baseStatus === "UNCERTIFIED") {
    // If confidence is LOW, it may be signal noise rather than a real failure
    if (confidenceScore < 40 && lowReliabilitySignals.length > 0) {
      recommendedVerdict = "UNCERTIFIED_NOISY";
    } else {
      recommendedVerdict = "UNCERTIFIED";
    }
  } else {
    recommendedVerdict = baseStatus;
  }

  // ── 14. Recommendation text ───────────────────────────────────────────────
  const recommendation = buildRecommendationText(recommendedVerdict, level, atRiskSignals, failedSignals, failureModes, { env, isProd, isProdBypassed });

  // ── 15. Suggested actions ─────────────────────────────────────────────────
  buildSuggestedActions(recommendedVerdict, level, atRiskSignals, failedSignals, failureModes, lowReliabilitySignals, suggestedActions, { isProd, isProdBypassed });

  return {
    recommended_verdict: recommendedVerdict,
    base_verdict: baseStatus,
    confidence_score: confidenceScore,
    confidence_level: level,
    reasoning,
    recommendation,
    suggested_actions: suggestedActions,
    at_risk_signals: atRiskSignals.map((s) => s.signal_id),
    low_reliability_signals: lowReliabilitySignals.map((s) => s.signal_id),
    production_adjustment: productionAdjustment
      ? { modifier: productionAdjustment.confidence_modifier, sample_count: productionAdjustment.sample_count, miss_rate_pct: productionAdjustment.miss_rate_pct }
      : null,
    computed_at: nowIso()
  };
}

function buildRecommendationText(verdict, level, atRisk, failed, modes, envCtx = {}) {
  const { env = "", isProd = false, isProdBypassed = false } =
    typeof envCtx === "string" ? { env: envCtx, isProd: envCtx === "prod" || envCtx === "production" } : envCtx;
  const atRiskNames = atRisk.slice(0, 3).map((s) => s.signal_id).join(", ");
  const failedNames = failed.slice(0, 3).map((f) => f.signal_id).join(", ");

  switch (verdict) {
    case "CERTIFIED":
      return level === "HIGH"
        ? "Proceed with full rollout. All signals are well above thresholds with high confidence."
        : "Proceed with rollout. Signal quality is acceptable — standard monitoring applies.";

    case "CERTIFIED_WITH_RISK":
      if (level === "HIGH") {
        return `Proceed, but monitor closely. ${atRiskNames ? `Watch ${atRiskNames} — within risk band of threshold.` : "Signal history shows elevated risk."} Standard rollout is acceptable.`;
      } else if (level === "MEDIUM") {
        return `Proceed with ${isProd ? "canary rollout (10–20% traffic)" : "limited rollout"}. ${atRiskNames ? `Monitor ${atRiskNames} for the first 30–60 minutes.` : "Monitor AI quality signals post-release."} Have a rollback plan ready.`;
      } else {
        return `Proceed with caution — confidence is LOW. ${isProd ? "Recommend 5% canary deployment with active monitoring." : "Deploy to a limited audience."} ${atRiskNames ? `${atRiskNames} are near threshold and signal reliability is suspect.` : ""} Consider recalibrating thresholds.`;
      }

    case "UNCERTIFIED":
      if (isProdBypassed) {
        return `Code is live in production without certification. ${failedNames ? `${failedNames} failed quality gates.` : "Required signals are below threshold."} Assess rollback risk, escalate to the appropriate approver, or apply a retroactive override with a monitoring plan.`;
      }
      if (isProd) {
        return `Release is in production and uncertified. ${failedNames ? `${failedNames} failed quality gates.` : "Required signals are below threshold."} Escalate immediately or roll back — do not continue operating without a retroactive override or remediation plan.`;
      }
      return `Block release. ${failedNames ? `${failedNames} failed quality gates.` : "Required signals are below threshold."} Fix failing signals and re-run evaluation before proceeding.`;

    case "UNCERTIFIED_NOISY":
      if (isProd) {
        return `Release is in production with low-confidence signals. ${failedNames ? `${failedNames} may be from unreliable sources` : "Signal reliability is poor"} — the failure may not be representative. Apply a retroactive override with an explicit monitoring plan while investigating signal quality.`;
      }
      return `Release is technically uncertified, but signal confidence is LOW (${failedNames ? `${failedNames} are from unreliable sources` : "signal reliability is poor"}). Consider whether the threshold needs recalibration, or request a senior override with a detailed monitoring plan.`;

    default:
      return "Insufficient data to produce a clear recommendation.";
  }
}

function buildSuggestedActions(verdict, level, atRisk, failed, modes, lowRel, out, envCtx = {}) {
  const { isProd = false, isProdBypassed = false } = envCtx;

  if (verdict === "CERTIFIED" && level === "HIGH") {
    out.push("Deploy with standard monitoring.");
    return;
  }

  if (verdict === "CERTIFIED_WITH_RISK") {
    if (level !== "HIGH") {
      out.push(level === "MEDIUM"
        ? "Use canary rollout: 10–20% of traffic for the first release."
        : "Use minimal canary: 5% of traffic with active alerting.");
    }
    if (atRisk.length > 0) {
      out.push(`Set up enhanced monitoring for: ${atRisk.slice(0, 4).map((s) => s.signal_id).join(", ")}.`);
      out.push(`Alert threshold: if any at-risk signal drops below threshold post-release, trigger rollback protocol.`);
    }
    if (modes.length > 0) {
      out.push(`Review failure mode "${modes[0].label}" — this pattern has caused issues previously.`);
    }
    if (lowRel.length > 0) {
      out.push(`Recalibrate signal reliability for: ${lowRel.slice(0, 3).map((s) => s.signal_id).join(", ")} — these sources are unstable.`);
    }
    out.push("Assign an on-call engineer for the first 30–60 minutes post-deploy.");
    return;
  }

  if (verdict === "UNCERTIFIED") {
    if (isProd) {
      // Code is already live — pre-ship "fix and re-run" advice is irrelevant.
      out.push("Assess rollback risk immediately. If prod impact is low and stable, document the decision.");
      if (failed.length > 0) {
        const failedNames = failed.slice(0, 3).map((f) => f.signal_id).join(", ");
        out.push(`Failing signals in prod: ${failedNames}. Monitor these closely for user impact.`);
      }
      out.push("Apply a retroactive override with justification, impact summary, and mitigation plan, or initiate a rollback.");
      out.push("Escalate to the appropriate approver — this release must not remain in prod without a named sign-off.");
      return;
    }
    for (const f of failed.slice(0, 4)) {
      out.push(`Fix **${f.signal_id}** — currently ${f.value ?? "missing"}, needs ${f.rule || "to meet threshold"}.`);
    }
    out.push("Re-run signal ingest and verdict after remediation.");
    out.push("Do not proceed until all hard gate signals pass.");
    return;
  }

  if (verdict === "UNCERTIFIED_NOISY") {
    if (isProd) {
      out.push("Apply a retroactive override with an explicit monitoring plan while investigating signal quality.");
      out.push("Investigate signal source reliability — the failure may not be representative.");
      if (atRisk.length > 0) out.push(`Watch closely: ${atRisk.map((s) => s.signal_id).join(", ")}.`);
      return;
    }
    out.push("Request a senior override with a detailed monitoring plan.");
    out.push("Investigate signal source reliability — consider re-running evals with a fresh sample.");
    out.push("Review threshold configuration — current thresholds may need recalibration.");
    if (atRisk.length > 0) out.push(`Focus monitoring on: ${atRisk.map((s) => s.signal_id).join(", ")}.`);
    return;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Load the full context needed to build a recommendation from DB.
 */
async function loadRecommendationContext(releaseId, workspaceId) {
  // Signals
  const sigRows = await queryAll("SELECT signal_id, value FROM signals WHERE release_id = ? ORDER BY id ASC", [releaseId]);
  const signals = {};
  for (const s of sigRows) signals[s.signal_id] = s.value;

  // Thresholds
  const threshRows = await queryAll(
    "SELECT signal_id, min_value, max_value, required_for_certification FROM thresholds WHERE workspace_id = ?",
    [workspaceId]
  );
  const thresholds = {};
  for (const t of threshRows) {
    thresholds[t.signal_id] = {
      min: t.min_value,
      max: t.max_value,
      required: t.required_for_certification === 1 || t.required_for_certification === true
    };
  }

  // Latest signal evaluation (failed signals from audit)
  const lastEval = await queryOne(
    `
    SELECT details_json FROM audit_events
    WHERE release_id = ? AND event_type = 'SIGNALS_INGESTED'
    ORDER BY id DESC LIMIT 1
  `,
    [releaseId]
  );
  let failedSignals = [],
    missingRequiredSignals = [];
  if (lastEval?.details_json) {
    try {
      const d = JSON.parse(lastEval.details_json);
      failedSignals = d.failed_signals || [];
      missingRequiredSignals = d.missing_required_signals || [];
    } catch (_) {}
  }

  // Failure modes
  const fmRows = await queryAll(
    `
    SELECT failure_mode, confidence, signals_json, computed_at
    FROM failure_mode_classifications WHERE release_id = ? ORDER BY confidence DESC
  `,
    [releaseId]
  );
  const failureModes = fmRows.map((r) => ({
    failure_mode: r.failure_mode,
    confidence: r.confidence,
    signals: safeJsonParse(r.signals_json, []),
    label: r.failure_mode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  }));

  // Early warning
  const ewRow = await queryOne("SELECT * FROM release_early_warnings WHERE release_id = ?", [releaseId]);
  const earlyWarning = ewRow
    ? { overall_risk: ewRow.overall_risk, warnings: safeJsonParse(ewRow.warnings_json, []) }
    : null;

  // Signal reliability
  const relRows = await queryAll(
    "SELECT signal_id, grade, on_time_rate, reliability FROM signal_reliability WHERE workspace_id = ?",
    [workspaceId]
  );
  const reliabilityMap = {};
  for (const r of relRows) reliabilityMap[r.signal_id] = r;

  // Override analytics (lightweight read from cache)
  const oaRow = await queryOne("SELECT * FROM override_analytics_cache WHERE workspace_id = ?", [workspaceId]);
  let overrideAnalytics = null;
  if (oaRow) {
    try {
      overrideAnalytics = {
        top_signals: JSON.parse(oaRow.top_signals || "[]"),
        override_rate_pct: oaRow.override_rate_pct
      };
    } catch (_) {}
  }

  // Top correlations
  const correlations = await queryAll(
    `
    SELECT signal_a, signal_b, correlation FROM signal_correlations
    WHERE workspace_id = ? AND ABS(correlation) >= 0.5
    ORDER BY ABS(correlation) DESC LIMIT 30
  `,
    [workspaceId]
  );

  // Production adjustment — feeds back historical accuracy into confidence
  let productionAdjustment = null;
  try {
    const paRow = await queryOne("SELECT * FROM production_adjustment_cache WHERE workspace_id = ?", [workspaceId]);
    if (paRow && paRow.sample_count >= 3) {
      productionAdjustment = {
        confidence_modifier: paRow.confidence_modifier,
        miss_rate_pct: paRow.miss_rate_pct,
        over_block_rate_pct: paRow.over_block_rate_pct,
        signal_drift: paRow.signal_drift_json ? JSON.parse(paRow.signal_drift_json) : {},
        sample_count: paRow.sample_count
      };
    }
  } catch (_) {}

  return { signals, thresholds, failedSignals, missingRequiredSignals, failureModes, earlyWarning, reliabilityMap, overrideAnalytics, correlations, productionAdjustment };
}

/**
 * Compute and persist a recommendation for a release.
 * Returns the recommendation object.
 */
async function computeAndPersistRecommendation(release) {
  const ctx = await loadRecommendationContext(release.id, release.workspace_id);
  const rec = buildRecommendation(release, ctx);
  await upsertReleaseIntelligence(release.id, release.workspace_id, { recommendation: rec });
  return rec;
}

/**
 * Get persisted recommendation for a release.
 */
async function getRecommendation(releaseId) {
  const row = await queryOne(
    "SELECT recommendation_json, decision_json FROM release_intelligence WHERE release_id = ?",
    [releaseId]
  );
  if (!row) return null;
  return parseRecommendationBlob(row.recommendation_json, row.decision_json);
}

function roundN(v, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

module.exports = { buildRecommendation, computeAndPersistRecommendation, getRecommendation, loadRecommendationContext };
