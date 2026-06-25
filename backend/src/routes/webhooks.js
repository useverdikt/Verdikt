"use strict";

const crypto = require("crypto");

const { queryOne, queryAll, run, transaction } = require("../database");
const config = require("../config");
const { nowIso } = require("../lib/time");
const { writeAudit } = require("../services/audit");
const { webhookRateLimit } = require("../middleware/rateLimit");
const { verifyInboundWebhookSignature } = require("../services/inboundWebhookSecrets");
const {
  getGithubLabelTrigger,
  DEFAULT_GITHUB_LABEL_NAME
} = require("../services/githubLabelTrigger");
const {
  consumeInstallState,
  setWorkspaceInstallation,
  fetchInstallationMeta,
  buildSetupRedirectUrl,
  resolveWorkspaceForGithubRepo
} = require("../services/githubApp");
const {
  evaluateReleaseAfterSignalIngest,
  mapIntegrationSignals,
  releaseVerdictLockedAgainstIngest,
  releaseIngestLockError,
  resolveReleaseForWorkspaceIngest
} = require("../services/domain");
const { openReleaseSession, buildGithubMappings } = require("../services/releaseIdentity");
const { scheduleIntegrationPullForRelease } = require("../services/labelTriggerIntegrationPull");
const { promoteReleaseOnMerge } = require("../services/releaseEnvironment");
const { ingestIntegrationSignals, resolveIntegrationIdempotencyKey } = require("../services/signalIngest");

const {
  AI_SIGNAL_DEFINITIONS,
  DEFAULT_COLLECTION_WINDOW_MINUTES,
  GITHUB_WEBHOOK_SECRET
} = config;

function timingSafeHexEq(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex || ""), "hex");
    const b = Buffer.from(String(bHex || ""), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyGitHubWebhookSignature(req) {
  if (!GITHUB_WEBHOOK_SECRET) return false;
  const signature = req.headers["x-hub-signature-256"];
  if (typeof signature !== "string" || !signature.startsWith("sha256=")) return false;
  const rawBody = req.rawBody || "";
  if (!rawBody) return false;
  const expected = crypto.createHmac("sha256", GITHUB_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return timingSafeHexEq(expected, signature.slice("sha256=".length));
}

const { classifyGithubReleaseType } = require("../services/githubReleaseClassification");

module.exports = function registerWebhookRoutes(app) {
app.get("/api/hooks/github/setup", async (req, res) => {
  try {
    const state = typeof req.query.state === "string" ? req.query.state.trim() : "";
    const installationId = Number(req.query.installation_id || 0);
    if (!state || !Number.isFinite(installationId) || installationId <= 0) {
      return res.status(400).json({ error: "state and installation_id are required" });
    }
    const installState = await consumeInstallState(state);
    if (!installState) {
      return res.status(400).json({ error: "invalid or expired state" });
    }
    let meta = null;
    try {
      meta = await fetchInstallationMeta(installationId);
    } catch (_) {}
    await setWorkspaceInstallation(installState.workspace_id, installationId, {
      accountLogin: meta?.account?.login || null,
      accountType: meta?.account?.type || null,
      userId: installState.user_id || null
    });
    const redirectUrl = buildSetupRedirectUrl({ github: "connected" });
    if (!redirectUrl) {
      return res.json({ ok: true, workspace_id: installState.workspace_id, installation_id: installationId });
    }
    return res.redirect(302, redirectUrl);
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/hooks/github", webhookRateLimit, async (req, res, next) => {
  try {
    if (!GITHUB_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "GitHub webhook not configured on server" });
    }
    if (!verifyGitHubWebhookSignature(req)) {
      return res.status(401).json({ error: "Invalid GitHub webhook signature" });
    }

    const event = String(req.headers["x-github-event"] || "");
    const deliveryId = String(req.headers["x-github-delivery"] || "");
    if (event === "ping") return res.json({ ok: true, event: "ping" });
    if (event !== "pull_request") return res.json({ ok: true, ignored: `event:${event}` });

    const payload = req.body || {};

    // ── PR merged → promote matching release environment to prod ─────────────
    if (payload.action === "closed" && payload.pull_request?.merged === true) {
      const owner = payload?.repository?.owner?.login;
      const repo = payload?.repository?.name;
      const prNumber = payload?.pull_request?.number;
      const baseBranch = String(payload?.pull_request?.base?.ref || "").trim();
      const isMainBranch = ["main", "master"].includes(baseBranch.toLowerCase());
      if (!owner || !repo || !prNumber) {
        return res.json({ ok: true, ignored: "merge_missing_fields" });
      }
      let workspaceId = await resolveWorkspaceForGithubRepo(owner, repo);
      if (!workspaceId) return res.json({ ok: true, ignored: "repo_not_connected" });

      // Find all releases for this workspace triggered by this PR number
      const matched = await queryAll(
        `SELECT * FROM releases WHERE workspace_id = ? AND pr_number = ? ORDER BY created_at DESC`,
        [workspaceId, prNumber]
      );
      if (!matched.length) return res.json({ ok: true, ignored: "no_matching_release", pr_number: prNumber });

      const newEnv = isMainBranch ? "prod" : baseBranch;
      let promoted = 0;
      let shippedWithoutCertification = 0;
      for (const rel of matched) {
        const result = await promoteReleaseOnMerge(rel, {
          workspaceId,
          prNumber,
          baseBranch,
          newEnv,
          isMainBranch
        });
        promoted++;
        if (result.shipped_without_certification) shippedWithoutCertification++;
      }
      console.log(`[${req.requestId}] github merge promotion`, {
        workspace_id: workspaceId,
        pr_number: prNumber,
        releases_promoted: promoted,
        shipped_without_certification: shippedWithoutCertification,
        new_environment: newEnv
      });
      return res.json({
        ok: true,
        promoted,
        shipped_without_certification: shippedWithoutCertification,
        environment: newEnv,
        pr_number: prNumber
      });
    }

    if (payload.action !== "labeled") return res.json({ ok: true, ignored: `action:${payload.action || "unknown"}` });

    const owner = payload?.repository?.owner?.login;
    const repo = payload?.repository?.name;
    const labelName = String(payload?.label?.name || "").trim();
    const prNumber = payload?.pull_request?.number;
    const commitSha = String(payload?.pull_request?.head?.sha || "").trim();
    const branch = String(payload?.pull_request?.head?.ref || "").trim();
    if (!owner || !repo || !labelName || !prNumber || !commitSha) {
      return res.status(400).json({ error: "Missing required pull_request payload fields" });
    }

    let workspaceId = await resolveWorkspaceForGithubRepo(owner, repo);
    if (!workspaceId) return res.json({ ok: true, ignored: "repo_not_connected" });
    const triggerCfg = await getGithubLabelTrigger(workspaceId);
    const configuredLabel = String(triggerCfg?.label_name || DEFAULT_GITHUB_LABEL_NAME).trim();
    const triggerEnabled = triggerCfg?.enabled === true;
    if (!triggerEnabled) return res.json({ ok: true, ignored: "label_trigger_disabled", workspace_id: workspaceId });
    if (labelName !== configuredLabel) {
      return res.json({ ok: true, ignored: "label_mismatch", expected_label: configuredLabel, received_label: labelName });
    }

    const legacyReleaseRef = `pr/${prNumber}@${commitSha.slice(0, 8)}`;
    const prTitle = String(payload?.pull_request?.title || "").replace(/\s+/g, " ").trim();
    const titledWithPr = prTitle ? `${prTitle} (#${prNumber})` : "";
    const releaseRef = titledWithPr ? titledWithPr.slice(0, 180) : legacyReleaseRef;
    const releaseType = classifyGithubReleaseType(payload, "model_update");
    const out = await openReleaseSession({
      workspaceId,
      version: releaseRef,
      releaseRef,
      releaseType,
      environment: "pre-prod",
      source: "github_label",
      mappings: buildGithubMappings({
        owner,
        repo,
        branch,
        pr_url: payload?.pull_request?.html_url || null
      }),
      aiContext: {
        trigger_mode: "github_label",
        label: labelName,
        pr_title: prTitle || null,
        legacy_release_ref: legacyReleaseRef,
        release_type_auto: releaseType
      },
      collectionWindowMinutes: DEFAULT_COLLECTION_WINDOW_MINUTES,
      // Delivery id changes per webhook dispatch; dedupe by logical PR signal identity instead.
      idempotencyKey: `github:${owner}/${repo}:pr:${prNumber}:sha:${commitSha}:label:${labelName}`,
      commitSha,
      prNumber,
      githubOwner: owner,
      githubRepo: repo,
      githubBranch: branch
    });

    if (out.reused) {
      scheduleIntegrationPullForRelease(out.release, { requestId: req.requestId, trigger: "github_label" });
      return res.status(200).json({ ok: true, reused: true, release_id: out.release?.id || null });
    }
    console.log(`[${req.requestId}] github label trigger`, {
      workspace_id: workspaceId,
      repo: `${owner}/${repo}`,
      pr_number: prNumber,
      release_id: out.release?.id
    });
    scheduleIntegrationPullForRelease(out.release, { requestId: req.requestId, trigger: "github_label" });
    return res.status(201).json({
      ok: true,
      release_id: out.release?.id || null,
      workspace_id: workspaceId,
      trigger: "github_label"
    });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/integrations/evals", webhookRateLimit, async (req, res, next) => {
  try {
  if (!(await verifyInboundWebhookSignature(req, req.params.workspaceId))) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }
  const {
    provider = "generic",
    payload = {},
    source,
    release_id,
    release_ref,
    version,
    commit_sha,
    pr_number,
    github_owner,
    github_repo
  } = req.body || {};
  const release = await resolveReleaseForWorkspaceIngest(req.params.workspaceId, {
    release_id,
    release_ref,
    version,
    commit_sha,
    pr_number,
    github_owner,
    github_repo
  });
  if (!release) {
    return res.status(404).json({
      error: "release not found for workspace",
      hint: "provide release_id, commit_sha (+ optional pr_number/repo), release_ref, or version"
    });
  }
  if (releaseVerdictLockedAgainstIngest(release)) {
    return res.status(409).json({
      error: releaseIngestLockError(release),
      status: release.status,
      release_id: release.id,
      environment: release.environment || null
    });
  }
  const mapped = mapIntegrationSignals(provider, payload);
  if (!Object.keys(mapped.signals).length) {
    return res.status(400).json({
      error: "no supported numeric signals found in payload",
      supported_signal_ids: Object.keys(AI_SIGNAL_DEFINITIONS).concat(["p95latency", "p99latency"])
    });
  }
  const ingestSource = typeof source === "string" && source.trim() ? source.trim() : `integration:${String(provider)}`;
  const out = await ingestIntegrationSignals({
    release,
    mappedSignals: mapped.signals,
    source: ingestSource,
    idempotencyKey: resolveIntegrationIdempotencyKey(req, [req.headers["x-github-delivery"]]),
    auditDetails: { provider: String(provider), ingest_mode: "workspace_webhook" }
  });
  return res.json({
    ...out,
    integration: {
      provider: String(provider),
      mapped_signal_ids: Object.keys(mapped.signals),
      ingest_mode: "workspace_webhook"
    }
  });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/integrations/ci", webhookRateLimit, async (req, res, next) => {
  try {
    if (!(await verifyInboundWebhookSignature(req, req.params.workspaceId))) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    const {
      commit_sha,
      pr_number,
      repo_owner,
      repo_name,
      github_branch,
      signals = {},
      release_id,
      release_ref,
      version,
      source = "ci_webhook"
    } = req.body || {};

    const sha = typeof commit_sha === "string" ? commit_sha.trim() : null;
    if (!release_id && !sha) {
      return res.status(400).json({ error: "commit_sha or release_id is required" });
    }
    if (!signals || typeof signals !== "object" || Array.isArray(signals)) {
      return res.status(400).json({ error: "signals must be an object of signal_id -> numeric value" });
    }

    let release = await resolveReleaseForWorkspaceIngest(req.params.workspaceId, {
      release_id,
      release_ref,
      version,
      commit_sha: sha,
      pr_number,
      github_owner: repo_owner,
      github_repo: repo_name
    });

    if (!release && sha) {
      const ref = release_ref || version || `ci@${sha.slice(0, 8)}`;
      const opened = await openReleaseSession({
        workspaceId: req.params.workspaceId,
        version: version || ref,
        releaseRef: ref,
        releaseType: "model_update",
        environment: "pre-prod",
        source: "ci_webhook",
        mappings: buildGithubMappings({
          owner: repo_owner,
          repo: repo_name,
          branch: github_branch
        }),
        aiContext: { trigger_mode: "ci_webhook" },
        commitSha: sha,
        prNumber: pr_number,
        githubOwner: repo_owner,
        githubRepo: repo_name,
        githubBranch: github_branch,
        auditEventType: "RELEASE_TRIGGERED",
        auditActorName: "ci_webhook"
      });
      release = opened.release;
    }

    if (!release) {
      return res.status(404).json({
        error: "release not found for workspace",
        hint: "apply verdikt:rc label first or provide matching commit_sha/pr_number/repo"
      });
    }
    if (releaseVerdictLockedAgainstIngest(release)) {
      return res.status(409).json({
        error: releaseIngestLockError(release),
        status: release.status,
        release_id: release.id,
        environment: release.environment || null
      });
    }

    const mapped = mapIntegrationSignals("ci", { signals });
    if (!Object.keys(mapped.signals).length) {
      return res.status(400).json({
        error: "no supported numeric signals found in payload",
        supported_signal_ids: Object.keys(AI_SIGNAL_DEFINITIONS).concat(["p95latency", "p99latency", "smoke", "e2e_regression"])
      });
    }

    const ingestSource = typeof source === "string" && source.trim() ? source.trim() : "ci_webhook";
    const out = await ingestIntegrationSignals({
      release,
      mappedSignals: mapped.signals,
      source: ingestSource,
      idempotencyKey: resolveIntegrationIdempotencyKey(req, [req.headers["x-github-delivery"]]),
      auditDetails: {
        provider: "ci",
        ingest_mode: "ci_webhook",
        commit_sha: sha,
        pr_number: pr_number ?? null,
        repo: repo_owner && repo_name ? `${repo_owner}/${repo_name}` : null
      }
    });
    return res.json({
      ...out,
      release_id: release.id,
      integration: {
        provider: "ci",
        mapped_signal_ids: Object.keys(mapped.signals),
        ingest_mode: "ci_webhook"
      }
    });
  } catch (e) {
    next(e);
  }
});
};
