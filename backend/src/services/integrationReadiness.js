"use strict";

/**
 * Partner onboarding: integration connection + SHA tagging readiness.
 */

const { queryAll } = require("../database");
const { normalizeCommitSha } = require("./releaseIdentity");
const {
  pullBraintrustExperimentSignals,
  pullBrowserStackSignals
} = require("./signalIngestFromSources");
const { decryptStoredApiKey, listIntegrations } = require("./signalIntegrations");

const SHA_TAG_GUIDE =
  "Verdikt matches integration data to the PR head commit SHA. Tag eval/build/deploy runs with that SHA or cert windows stay COLLECTING.";

const INTEGRATION_SETUP = {
  braintrust: {
    label: "Braintrust",
    mode: "api_pull",
    sha_required: true,
    sha_fields: ["git metadata commit", "metadata.git_sha", "metadata.commit_sha"],
    setup_steps: [
      "Run evals from CI on the same commit as the PR head.",
      "Pass git_metadata with commit SHA, or enable org-level git metadata capture in Braintrust.",
      "Experiment name or metadata must match the PR commit when Verdikt auto-pulls."
    ],
    doc_hint: "https://www.braintrust.dev/docs"
  },
  browserstack: {
    label: "BrowserStack",
    mode: "api_pull",
    sha_required: true,
    sha_fields: ["build_tag", "GIT_SHA (SDK)", "build name containing commit"],
    setup_steps: [
      "Use BrowserStack SDK/CLI so git commit is auto-detected, OR",
      "Set build_tag to the full PR head SHA when triggering the build.",
      "Verdikt matches Automate builds by build name or build_tag."
    ],
    doc_hint: "https://www.browserstack.com/docs"
  },
  sentry: {
    label: "Sentry",
    mode: "api_pull",
    sha_required: true,
    sha_fields: ["release version = commit SHA", "sentry-cli set-commits --auto"],
    setup_steps: [
      "Create a Sentry release named with the git commit SHA (full or short).",
      "Run: sentry-cli releases set-commits $VERSION --auto in CI before deploy.",
      "Verdikt looks up release health by SHA-derived release name."
    ],
    doc_hint: "https://docs.sentry.io/product/releases/"
  },
  datadog: {
    label: "Datadog",
    mode: "api_pull",
    sha_required: true,
    sha_fields: ["git.commit.sha tag", "DD_GIT_COMMIT_SHA", "{{commit_sha}} in query"],
    setup_steps: [
      "Set DD_GIT_COMMIT_SHA at build/deploy to the PR head SHA.",
      "Configure workspace Datadog query template with {{commit_sha}} or git.commit.sha filter.",
      "Run datadog-ci git-metadata upload in CI for deployment tracking."
    ],
    doc_hint: "https://docs.datadoghq.com/source_code/service-mapping/"
  },
  langsmith: {
    label: "LangSmith",
    mode: "api_pull",
    sha_required: true,
    sha_fields: ["run metadata commit_hash", "extra.metadata.git_sha"],
    setup_steps: [
      "Tag LangSmith runs with commit metadata matching the PR head SHA.",
      "Verdikt matches runs by version string or metadata commit hash."
    ],
    doc_hint: "https://docs.smith.langchain.com"
  }
};

async function listWorkspaceIntegrations(workspaceId) {
  return listIntegrations(workspaceId);
}

function buildIntegrationChecklistRow(sourceId, row) {
  const guide = INTEGRATION_SETUP[sourceId] || {
    label: sourceId,
    mode: "api_pull",
    sha_required: true,
    setup_steps: ["Connect API credentials in Settings → Signal sources."]
  };
  const connected = !!(row && row.connected);
  return {
    source_id: sourceId,
    label: guide.label,
    mode: guide.mode,
    connected: !!connected,
    sha_required: guide.sha_required !== false,
    sha_fields: guide.sha_fields || [],
    setup_steps: guide.setup_steps || [],
    doc_hint: guide.doc_hint || null,
    status: connected ? "connected" : "not_connected"
  };
}

async function getIntegrationReadiness(workspaceId) {
  const rows = await listWorkspaceIntegrations(workspaceId);
  const byId = Object.fromEntries(rows.map((r) => [r.source_id, r]));
  const integrations = Object.keys(INTEGRATION_SETUP).map((id) => buildIntegrationChecklistRow(id, byId[id]));
  const connected = integrations.filter((i) => i.connected);
  return {
    workspace_id: workspaceId,
    sha_tagging_required: true,
    summary: SHA_TAG_GUIDE,
    integrations,
    connected_count: connected.length,
    ready_for_auto_pull: connected.length > 0,
    partner_checklist: [
      "Apply verdikt:rc on a PR with a known head SHA.",
      "Confirm each required integration shows Connected below.",
      "Run partner CI so eval/build tools tag runs with that same SHA.",
      "Use Probe SHA match (Settings) or Signal Simulator if pull fails."
    ]
  };
}

async function probeShaMatchForSource(sourceId, workspaceId, releaseStub) {
  const rows = await queryAll(
    "SELECT source_id, api_key, extra_json, verified_at, last_verify_error FROM signal_integrations WHERE workspace_id = ? AND source_id = ?",
    [workspaceId, sourceId]
  );
  const row = rows[0];
  if (!row || !row.api_key) {
    return { source_id: sourceId, connected: false, matched: false, error: "not_connected" };
  }
  let extra = {};
  try {
    extra = JSON.parse(row.extra_json || "{}");
  } catch {
    extra = {};
  }
  const apiKeyPlain = decryptStoredApiKey(row.api_key, workspaceId, sourceId);

  if (process.env.NODE_ENV === "test" || process.env.SKIP_INTEGRATION_PULL === "1") {
    return { source_id: sourceId, connected: true, matched: true, skipped: true };
  }
  try {
    let result;
    if (sourceId === "braintrust") {
      result = await pullBraintrustExperimentSignals(apiKeyPlain, releaseStub);
    } else if (sourceId === "browserstack") {
      result = await pullBrowserStackSignals(extra.username || "", apiKeyPlain, releaseStub);
    } else {
      return {
        source_id: sourceId,
        connected: true,
        matched: null,
        message: "Live SHA probe runs for Braintrust and BrowserStack; open a cert window to test others."
      };
    }
    return {
      source_id: sourceId,
      connected: true,
      matched: !!result.matched,
      error: result.error || null,
      signal_count: result.signals ? Object.keys(result.signals).length : 0
    };
  } catch (e) {
    return { source_id: sourceId, connected: true, matched: false, error: e.message || String(e) };
  }
}

async function probeIntegrationReadiness(workspaceId, commitSha, { version = "readiness-probe" } = {}) {
  const sha = normalizeCommitSha(commitSha);
  if (!sha) {
    return { error: "commit_sha is required (PR head SHA, 7+ chars)" };
  }
  const releaseStub = { version, commit_sha: sha, github_repo: "probe" };
  const readiness = await getIntegrationReadiness(workspaceId);
  const probes = [];
  for (const row of readiness.integrations) {
    if (!row.connected) {
      probes.push({ source_id: row.source_id, connected: false, matched: false, error: "not_connected" });
      continue;
    }
    probes.push(await probeShaMatchForSource(row.source_id, workspaceId, releaseStub));
  }
  const matchedCount = probes.filter((p) => p.matched === true).length;
  return {
    workspace_id: workspaceId,
    commit_sha: sha,
    probes,
    any_matched: matchedCount > 0,
    matched_count: matchedCount,
    ready: matchedCount > 0,
    hint: matchedCount === 0 ? SHA_TAG_GUIDE : null
  };
}

module.exports = {
  INTEGRATION_SETUP,
  SHA_TAG_GUIDE,
  getIntegrationReadiness,
  probeIntegrationReadiness
};
