"use strict";

const { queryOne } = require("../database");

const SHA_TAG_HINT =
  "Tag eval runs with git commit metadata (git_sha / commit_sha) matching the PR head SHA, or use Signal Simulator / POST signals.";

const ERROR_MESSAGES = {
  empty_release_identity: "Release has no commit SHA — connect GitHub label trigger or create_release with commit_sha.",
  invalid_braintrust_key: "Braintrust API key rejected — re-save in Settings → Signal sources.",
  braintrust_http_401: "Braintrust API key rejected — re-save in Settings → Signal sources.",
  no_experiment_for_version:
    "Braintrust connected but no experiment matched this commit SHA. Verify eval runs are tagged with git_sha metadata.",
  missing_browserstack_credentials: "BrowserStack credentials missing — add username + access key in Settings.",
  invalid_browserstack_credentials: "BrowserStack credentials rejected — re-save in Settings.",
  no_build_for_version:
    "BrowserStack connected but no build matched this commit SHA. Tag builds with the git commit or version string.",
  no_browserstack_metrics: "BrowserStack build found but no pass-rate metrics were available.",
  langsmith_http_401: "LangSmith API key rejected — re-save in Settings.",
  no_run_for_version:
    "LangSmith connected but no run matched this commit SHA. Tag runs with git metadata or metadata.commit_hash.",
  release_not_found:
    "Sentry connected but no release matched this commit SHA. Set Sentry release to the git SHA or short SHA.",
  no_sentry_metrics: "Sentry release found but crash/error metrics were empty.",
  missing_datadog_keys: "Datadog API + app keys missing — re-save in Settings.",
  invalid_datadog_site: "Datadog site invalid — check Settings → Signal sources.",
  no_datadog_metrics:
    "Datadog connected but no metrics matched this commit SHA. Scope queries with git.commit.sha or {{commit_sha}}.",
  no_signals: "Connected but no signals matched this release identity.",
  no_connected_integrations: "No signal integrations configured — connect sources in Settings or ingest via API."
};

const SOURCE_LABELS = {
  braintrust: "Braintrust",
  langsmith: "LangSmith",
  browserstack: "BrowserStack",
  sentry: "Sentry",
  datadog: "Datadog"
};

function sourceLabel(sourceId) {
  return SOURCE_LABELS[sourceId] || String(sourceId || "integration");
}

function humanizePullError(sourceId, errorCode, release) {
  const code = String(errorCode || "no_signals");
  const base = ERROR_MESSAGES[code] || ERROR_MESSAGES.no_signals;
  const sha = release?.commit_sha ? String(release.commit_sha).slice(0, 12) : null;
  const label = sourceLabel(sourceId);
  if (sha && /sha|version|experiment|build|run|release|metrics/i.test(base)) {
    return `${label}: ${base} (looking for SHA ${sha}…). ${SHA_TAG_HINT}`;
  }
  return `${label}: ${base}`;
}

/**
 * Turn pullConnectedSourcesForRelease output into UI/audit-friendly warnings.
 */
function buildIntegrationPullWarnings(pullResult, release) {
  const warnings = [];
  const sources = pullResult?.sources || {};

  if (pullResult?.message === "no_connected_integrations") {
    warnings.push({
      source: null,
      code: "no_connected_integrations",
      message: ERROR_MESSAGES.no_connected_integrations
    });
    return warnings;
  }

  for (const [sourceId, result] of Object.entries(sources)) {
    if (result?.ok) continue;
    const code = result?.error || "no_signals";
    warnings.push({
      source: sourceId,
      code,
      message: humanizePullError(sourceId, code, release)
    });
  }

  return warnings;
}

function summarizePullResult(pullResult, release) {
  const sources = pullResult?.sources || {};
  const results = {};
  for (const [sourceId, result] of Object.entries(sources)) {
    results[sourceId] = {
      ok: !!result?.ok,
      error: result?.error || null,
      message: result?.ok
        ? `${sourceLabel(sourceId)} signals ingested.`
        : humanizePullError(sourceId, result?.error || "no_signals", release)
    };
  }
  return {
    ok: !!pullResult?.ok,
    commit_sha: release?.commit_sha || null,
    pr_number: release?.pr_number ?? null,
    results,
    warnings: buildIntegrationPullWarnings(pullResult, release)
  };
}

async function getLatestIntegrationPullForRelease(releaseId) {
  const row = await queryOne(
    `SELECT details_json, created_at FROM audit_events
     WHERE release_id = ? AND event_type = 'SIGNAL_SOURCES_PULL'
     ORDER BY id DESC LIMIT 1`,
    [releaseId]
  );
  if (!row) return null;
  try {
    const details = JSON.parse(row.details_json || "{}");
    return {
      at: row.created_at,
      trigger: details.trigger || null,
      ok: details.ok,
      sources: Array.isArray(details.sources) ? details.sources : [],
      warnings: Array.isArray(details.warnings) ? details.warnings : [],
      results: details.results && typeof details.results === "object" ? details.results : {}
    };
  } catch {
    return { at: row.created_at, warnings: [], results: {} };
  }
}

module.exports = {
  SHA_TAG_HINT,
  humanizePullError,
  buildIntegrationPullWarnings,
  summarizePullResult,
  getLatestIntegrationPullForRelease
};
