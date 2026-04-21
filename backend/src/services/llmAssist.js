"use strict";

/**
 * llmAssist.js
 *
 * Optional LLM enrichment layer. Sits strictly OUTSIDE the deterministic verdict
 * path — the verdict is always committed before this runs, and failures here
 * never block or alter the authoritative verdict.
 *
 * Responsibilities:
 *   - maybeEnrichVerdictIntelligence  — enriches an already-issued intelligence
 *     object with an LLM-generated summary / recommended_actions.
 *   - enqueueVerdictAssistiveEnrichment — fires via setImmediate so it never
 *     adds latency to the signal-ingest response.
 *   - maybeEnrichSuggestionReason     — produces a human-readable one-liner for
 *     threshold suggestions (used by thresholdAdvisor).
 *
 * Architectural contract:
 *   If ENABLE_ASSISTIVE_LLM is false, or if the LLM call fails, the deterministic
 *   intelligence remains untouched. No verdict is ever gated on this path.
 */

const {
  ENABLE_ASSISTIVE_LLM,
  ENABLE_THRESHOLD_SUGGESTIONS_LLM,
  AI_PROVIDER_API_KEY,
  AI_PROVIDER,
  AI_MODEL
} = require("../config");
const { withTimeoutRetry, callIntelligenceModel, tryParseJsonObject } = require("./aiClient");
const { nowIso } = require("../lib/time");
const { upsertReleaseIntelligence, buildIntelligenceTrace } = require("./intelligenceBuilder");

// ─── Verdict intelligence enrichment ─────────────────────────────────────────

function isRegressionFailureSignal(f) {
  return f.failure_kind === "regression" || (f.rule && String(f.rule).startsWith("regression:"));
}

async function maybeEnrichVerdictIntelligence({ release, failedSignals, missingRequiredSignals, intelligence }) {
  if (!ENABLE_ASSISTIVE_LLM || !AI_PROVIDER_API_KEY || typeof fetch !== "function") return intelligence;

  const regressionFailures = failedSignals.filter(isRegressionFailureSignal);
  const absoluteFailures = failedSignals.filter((f) => f.failure_kind === "absolute_threshold");

  const prompt = [
    "You are enriching a deterministic release risk brief.",
    "Distinguish two failure classes:",
    "(1) absolute_threshold — current signal values violated configured min/max floors or ceilings; compare to thresholds, not to history.",
    "(2) regression — AI quality signals worsened versus the prior certified baseline beyond the allowed delta; this is relative change, not a raw floor.",
    "If both appear, mention both in the summary and prioritize remediation that addresses regression separately from raw threshold misses.",
    "If regression_context.no_prior_certified_baseline is true, acknowledge in a friendly, reassuring tone that there is no prior certified baseline yet, that regression-from-baseline checks were skipped, and that absolute thresholds still applied — normal for early certified runs.",
    "When regression_history is present, use consecutive_regression_releases and prior_regression_failures_in_window to describe streaks and repeated regressions.",
    "The summary should sound like governance intelligence, not a calculator — connect regression facts to risk and next steps.",
    "Return JSON only with keys: summary, recommended_actions.",
    "summary must be one or two concise sentences (max ~400 characters).",
    "recommended_actions must be an array of up to 3 short actions.",
    JSON.stringify({
      release_type: release.release_type,
      environment: release.environment,
      risk_level: intelligence.risk_level,
      absolute_threshold_failures: absoluteFailures.map((f) => ({
        signal_id: f.signal_id,
        value: f.value,
        rule: f.rule
      })),
      regression_failures: regressionFailures.map((f) => ({
        signal_id: f.signal_id,
        drop_amount: f.drop_amount,
        max_allowed_drop: f.max_allowed_drop,
        baseline_value: f.baseline_value,
        rule: f.rule
      })),
      missing_required_signals: missingRequiredSignals,
      regression_context: intelligence.regression_context || null,
      regression_history: intelligence.regression_history || null
    })
  ].join("\n");

  const text = await withTimeoutRetry(
    () => callIntelligenceModel(prompt, { maxTokens: 480 })
  ).catch(() => "");
  if (!text) return intelligence;

  try {
    const parsed = tryParseJsonObject(text);
    if (!parsed || typeof parsed !== "object") return intelligence;
    const next = { ...intelligence };
    if (typeof parsed.summary === "string" && parsed.summary.trim()) {
      next.summary = parsed.summary.trim().slice(0, 420);
    }
    if (Array.isArray(parsed.recommended_actions) && parsed.recommended_actions.length) {
      next.recommended_actions = parsed.recommended_actions
        .filter((v) => typeof v === "string" && v.trim())
        .slice(0, 3)
        .map((v) => v.trim().slice(0, 140));
    }
    next.source = `assistive_${AI_PROVIDER}_v1`;
    next.model = AI_MODEL;
    next.prompt_version = "assistive_verdict_v1";
    next.generated_at = nowIso();
    return next;
  } catch {
    return intelligence;
  }
}

/**
 * Fire-and-forget enrichment via setImmediate — never blocks the signal-ingest
 * response. On completion the updated intelligence is persisted to the DB.
 */
function enqueueVerdictAssistiveEnrichment({
  releaseId,
  workspaceId,
  release,
  failedSignals,
  missingRequiredSignals,
  deterministicIntelligence
}) {
  if (!ENABLE_ASSISTIVE_LLM || !AI_PROVIDER_API_KEY || typeof fetch !== "function") return;
  setImmediate(() => {
    void (async () => {
      try {
        const enriched = await maybeEnrichVerdictIntelligence({
          release,
          failedSignals,
          missingRequiredSignals,
          intelligence: deterministicIntelligence
        });
        const trace = buildIntelligenceTrace({
          releaseId,
          workspaceId,
          releaseType: release.release_type,
          output: enriched
        });
        trace.model = enriched?.model || trace.model;
        trace.prompt_version = enriched?.prompt_version || trace.prompt_version;
        await upsertReleaseIntelligence(releaseId, workspaceId, { verdict: enriched, trace });
      } catch (err) {
        console.error("[verdict_assistive_enrichment]", releaseId, err);
      }
    })();
  });
}

// ─── Threshold suggestion enrichment ─────────────────────────────────────────

async function maybeEnrichSuggestionReason(suggestion, { window }) {
  if (!ENABLE_THRESHOLD_SUGGESTIONS_LLM || !AI_PROVIDER_API_KEY || typeof fetch !== "function") {
    return suggestion.reason;
  }
  const payload = {
    signal_id: suggestion.signal_id,
    direction: suggestion.direction,
    current_threshold: suggestion.current_threshold,
    suggested_threshold: suggestion.suggested_threshold,
    confidence: suggestion.confidence,
    fail_rate: suggestion.fail_rate,
    basis_window: suggestion.basis_window || window
  };
  const prompt = [
    "You are assisting with release threshold tuning.",
    "Given the JSON context, output exactly one sentence under 140 characters.",
    "Be specific, explain why the suggested threshold is safer/practical.",
    "Do not include preamble.",
    JSON.stringify(payload)
  ].join("\n");
  const text = await withTimeoutRetry(
    () => callIntelligenceModel(prompt, { maxTokens: 120 })
  ).catch(() => "");
  if (!text) return suggestion.reason;
  return text.replace(/\s+/g, " ").slice(0, 140);
}

module.exports = {
  maybeEnrichVerdictIntelligence,
  enqueueVerdictAssistiveEnrichment,
  maybeEnrichSuggestionReason
};
