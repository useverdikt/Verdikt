"use strict";

const { queryAll } = require("../database");

const EFFECT_TYPES = [
  "vcs_writeback",
  "outbound_webhook",
  "release_callback",
  "slack_verdict"
];
const DEFAULT_WINDOW_DAYS = 7;
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 30;
const MIN_ELIGIBLE_COMPARISONS = 20;
const MIN_OBSERVATION_COVERAGE_PCT = 99;
const MAX_P95_COMPARISON_SECONDS = 5 * 60;

const READINESS_SQL = `
  SELECT
    effect_type,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE state = 'shadow_matched')::int AS matched,
    COUNT(*) FILTER (WHERE state = 'shadow_mismatch')::int AS mismatched,
    COUNT(*) FILTER (WHERE state = 'shadow_skipped')::int AS skipped,
    COUNT(*) FILTER (WHERE state = 'shadow_unverifiable')::int AS unverifiable,
    COUNT(*) FILTER (WHERE state = 'retry')::int AS retrying,
    COUNT(*) FILTER (
      WHERE state IN ('pending', 'retry', 'processing')
    )::int AS backlog,
    COUNT(*) FILTER (
      WHERE (
             state IN ('pending', 'retry')
         AND next_attempt_at < NOW() - ($3::int * INTERVAL '1 second')
            )
         OR (
             state = 'processing'
         AND claimed_until < NOW()
            )
    )::int AS stale_backlog,
    COUNT(*) FILTER (WHERE state = 'dead_letter')::int AS dead_letters,
    COUNT(*) FILTER (
      WHERE (
             shadow_result_json->>'legacy_response_status' ~ '^[0-9]+$'
         AND (shadow_result_json->>'legacy_response_status')::int NOT BETWEEN 200 AND 299
            )
         OR COALESCE(shadow_result_json->>'legacy_error', '') <> ''
         OR (
             legacy_response_status IS NOT NULL
         AND legacy_response_status NOT BETWEEN 200 AND 299
            )
         OR legacy_error_code IS NOT NULL
         OR (
             legacy_comparison_json IS NOT NULL
         AND COALESCE(legacy_comparison_json->>'outcome', 'unknown') <> 'succeeded'
            )
    )::int AS failed_legacy_deliveries,
    COUNT(*) FILTER (
      WHERE effect_type IN ('release_callback', 'slack_verdict')
        AND state <> 'shadow_skipped'
    )::int AS observation_expected,
    COUNT(*) FILTER (
      WHERE effect_type IN ('release_callback', 'slack_verdict')
        AND state <> 'shadow_skipped'
        AND legacy_observed_at IS NOT NULL
    )::int AS observation_recorded,
    percentile_cont(0.95) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at))
    ) FILTER (
      WHERE state IN (
        'shadow_matched',
        'shadow_mismatch',
        'shadow_skipped',
        'shadow_unverifiable'
      )
    ) AS p95_comparison_seconds
  FROM outbound_effect_outbox
  WHERE workspace_id = $1
    AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
  GROUP BY effect_type
  ORDER BY effect_type ASC
`;

function boundedWindowDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.floor(parsed)));
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function classifyEffect(row, criteria) {
  const matched = numberValue(row.matched);
  const mismatched = numberValue(row.mismatched);
  const deadLetters = numberValue(row.dead_letters);
  const failedLegacyDeliveries = numberValue(row.failed_legacy_deliveries);
  const staleBacklog = numberValue(row.stale_backlog);
  const eligibleComparisons = matched + mismatched;
  const observationExpected = numberValue(row.observation_expected);
  const observationRecorded = numberValue(row.observation_recorded);
  const observationCoveragePct =
    observationExpected > 0
      ? Math.round((observationRecorded / observationExpected) * 10_000) / 100
      : null;
  const p95ComparisonSeconds =
    row.p95_comparison_seconds == null ? null : numberValue(row.p95_comparison_seconds);
  const blockers = [];

  if (mismatched > 0) blockers.push("shadow_mismatch");
  if (deadLetters > 0) blockers.push("dead_letter");
  if (failedLegacyDeliveries > 0) blockers.push("legacy_delivery_failed");
  if (staleBacklog > 0) blockers.push("stale_backlog");
  if (
    observationCoveragePct != null &&
    observationCoveragePct < criteria.min_observation_coverage_pct
  ) {
    blockers.push("observation_coverage");
  }
  if (
    p95ComparisonSeconds != null &&
    p95ComparisonSeconds > criteria.max_p95_comparison_seconds
  ) {
    blockers.push("comparison_latency");
  }

  let status = "ready";
  if (blockers.length > 0) status = "blocked";
  else if (eligibleComparisons < criteria.min_eligible_comparisons) {
    status = "insufficient_data";
  }

  return {
    effect_type: row.effect_type,
    status,
    blockers,
    total: numberValue(row.total),
    eligible_comparisons: eligibleComparisons,
    matched,
    mismatched,
    skipped: numberValue(row.skipped),
    unverifiable: numberValue(row.unverifiable),
    retrying: numberValue(row.retrying),
    backlog: numberValue(row.backlog),
    stale_backlog: staleBacklog,
    dead_letters: deadLetters,
    failed_legacy_deliveries: failedLegacyDeliveries,
    observation_expected: observationExpected,
    observation_recorded: observationRecorded,
    observation_coverage_pct: observationCoveragePct,
    p95_comparison_seconds:
      p95ComparisonSeconds == null ? null : Math.round(p95ComparisonSeconds * 100) / 100
  };
}

async function getOutboundEffectReadiness(
  workspaceId,
  {
    windowDays = DEFAULT_WINDOW_DAYS,
    minEligibleComparisons = MIN_ELIGIBLE_COMPARISONS,
    minObservationCoveragePct = MIN_OBSERVATION_COVERAGE_PCT,
    maxP95ComparisonSeconds = MAX_P95_COMPARISON_SECONDS,
    staleBacklogSeconds = 5 * 60,
    queryAllFn = queryAll,
    now = new Date()
  } = {}
) {
  const boundedDays = boundedWindowDays(windowDays);
  const criteria = {
    min_eligible_comparisons: Math.max(1, Math.floor(Number(minEligibleComparisons) || 1)),
    min_observation_coverage_pct: Math.min(
      100,
      Math.max(0, Number(minObservationCoveragePct) || 0)
    ),
    max_p95_comparison_seconds: Math.max(1, Number(maxP95ComparisonSeconds) || 1),
    max_stale_backlog_seconds: Math.max(1, Math.floor(Number(staleBacklogSeconds) || 1))
  };
  const rows = await queryAllFn(READINESS_SQL, [
    workspaceId,
    boundedDays,
    criteria.max_stale_backlog_seconds
  ]);
  const byEffect = new Map(rows.map((row) => [row.effect_type, row]));
  const effects = EFFECT_TYPES.map((effectType) =>
    classifyEffect(
      byEffect.get(effectType) || {
        effect_type: effectType,
        total: 0
      },
      criteria
    )
  );
  const observedEffects = effects.filter((effect) => effect.total > 0 && effect.skipped < effect.total);
  const blockers = effects.flatMap((effect) =>
    effect.blockers.map((blocker) => `${effect.effect_type}:${blocker}`)
  );

  let status = "ready";
  if (blockers.length > 0) status = "blocked";
  else if (
    observedEffects.length === 0 ||
    observedEffects.some((effect) => effect.status === "insufficient_data")
  ) {
    status = "insufficient_data";
  }

  return {
    workspace_id: workspaceId,
    generated_at: now.toISOString(),
    window_days: boundedDays,
    status,
    ready: status === "ready",
    blockers,
    criteria,
    effects
  };
}

module.exports = {
  EFFECT_TYPES,
  DEFAULT_WINDOW_DAYS,
  MIN_ELIGIBLE_COMPARISONS,
  MIN_OBSERVATION_COVERAGE_PCT,
  MAX_P95_COMPARISON_SECONDS,
  boundedWindowDays,
  classifyEffect,
  getOutboundEffectReadiness
};
