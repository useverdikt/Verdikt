"use strict";

const crypto = require("crypto");

const { queryOne, run, transaction } = require("../database");
const config = require("../config");
const { nowIso, toIsoPlusMinutes } = require("../lib/time");
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
  findWorkspaceByRepo
} = require("../services/githubApp");
const {
  evaluateReleaseAfterSignalIngest,
  mapIntegrationSignals,
  releaseVerdictLockedAgainstIngest,
  resolveReleaseForWorkspaceIngest
} = require("../services/domain");

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

async function createReleaseSession({
  workspaceId,
  releaseRef,
  releaseType,
  environment,
  source,
  mappings,
  aiContext,
  collectionWindowMinutes,
  idempotencyKey,
  commitSha = null,
  prNumber = null
}) {
  const key = idempotencyKey || `${workspaceId}:${releaseRef}:${source}`;
  const existing = await queryOne("SELECT release_id FROM webhook_events WHERE idempotency_key = ?", [key]);
  if (existing) {
    const release = await queryOne("SELECT * FROM releases WHERE id = ?", [existing.release_id]);
    return { reused: true, release };
  }

  const releaseId = `rel_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const now = nowIso();
  const windowMins = Number.isFinite(+collectionWindowMinutes)
    ? Math.max(5, Math.min(24 * 60, +collectionWindowMinutes))
    : DEFAULT_COLLECTION_WINDOW_MINUTES;
  const deadline = toIsoPlusMinutes(windowMins);
  await run(
    `INSERT INTO releases (
      id, workspace_id, version, release_type, environment, status, created_at, updated_at,
      release_ref, trigger_source, mappings_json, collection_deadline, verdict_issued_at, ai_context_json, commit_sha, pr_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      releaseId,
      workspaceId,
      releaseRef,
      releaseType,
      environment,
      "COLLECTING",
      now,
      now,
      releaseRef,
      source,
      JSON.stringify(mappings || {}),
      deadline,
      null,
      JSON.stringify(aiContext || {}),
      commitSha || null,
      Number.isFinite(Number(prNumber)) ? Number(prNumber) : null
    ]
  );
  await run("INSERT INTO webhook_events (idempotency_key, release_id, created_at) VALUES (?, ?, ?)", [key, releaseId, now]);
  await writeAudit({
    workspaceId,
    releaseId,
    eventType: "RELEASE_TRIGGERED",
    actorType: "SYSTEM",
    actorName: source,
    details: { release_ref: releaseRef, mappings, ai_context: aiContext, collection_window_minutes: windowMins }
  });
  const release = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
  return { reused: false, release, collection_deadline: deadline };
}

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

    let workspaceId = await findWorkspaceByRepo(owner, repo);
    if (!workspaceId) {
      const fallback = await queryOne(
        `SELECT workspace_id
         FROM vcs_integrations
         WHERE enabled = 1 AND provider = 'github' AND LOWER(owner) = LOWER(?) AND LOWER(repo) = LOWER(?)
         LIMIT 1`,
        [owner, repo]
      );
      workspaceId = fallback?.workspace_id || null;
    }
    if (!workspaceId) return res.json({ ok: true, ignored: "repo_not_connected" });
    const triggerCfg = await getGithubLabelTrigger(workspaceId);
    const configuredLabel = String(triggerCfg?.label_name || DEFAULT_GITHUB_LABEL_NAME).trim();
    const triggerEnabled = triggerCfg?.enabled === true;
    if (!triggerEnabled) return res.json({ ok: true, ignored: "label_trigger_disabled", workspace_id: workspaceId });
    if (labelName !== configuredLabel) {
      return res.json({ ok: true, ignored: "label_mismatch", expected_label: configuredLabel, received_label: labelName });
    }

    const releaseRef = `pr/${prNumber}@${commitSha.slice(0, 8)}`;
    const out = await createReleaseSession({
      workspaceId,
      releaseRef,
      releaseType: "model_update",
      environment: "pre-prod",
      source: "github_label",
      mappings: {
        provider: "github",
        owner,
        repo,
        branch,
        pr_url: payload?.pull_request?.html_url || null
      },
      aiContext: {
        trigger_mode: "github_label",
        label: labelName
      },
      collectionWindowMinutes: DEFAULT_COLLECTION_WINDOW_MINUTES,
      idempotencyKey: `github:${deliveryId || "no_delivery"}:${owner}/${repo}:pr:${prNumber}:sha:${commitSha}:label:${labelName}`,
      commitSha,
      prNumber
    });

    if (out.reused) return res.status(200).json({ ok: true, reused: true, release_id: out.release?.id || null });
    console.log(`[${req.requestId}] github label trigger`, {
      workspace_id: workspaceId,
      repo: `${owner}/${repo}`,
      pr_number: prNumber,
      release_id: out.release?.id
    });
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
  const { provider = "generic", payload = {}, source, release_id, release_ref, version } = req.body || {};
  const release = await resolveReleaseForWorkspaceIngest(req.params.workspaceId, { release_id, release_ref, version });
  if (!release) {
    return res.status(404).json({ error: "release not found for workspace", hint: "provide release_id, release_ref, or version" });
  }
  if (releaseVerdictLockedAgainstIngest(release)) {
    return res.status(409).json({
      error: "release verdict is locked after certification; further signal ingest is not accepted",
      status: release.status,
      release_id: release.id
    });
  }
  const mapped = mapIntegrationSignals(provider, payload);
  if (!Object.keys(mapped.signals).length) {
    return res.status(400).json({
      error: "no supported numeric signals found in payload",
      supported_signal_ids: Object.keys(AI_SIGNAL_DEFINITIONS).concat(["p95latency", "p99latency"])
    });
  }
  const insertHookSql =
    "INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES (?, ?, ?, ?, ?)";
  const ingestSource = typeof source === "string" && source.trim() ? source.trim() : `integration:${String(provider)}`;
  await transaction(async (tx) => {
    for (const [signalId, value] of Object.entries(mapped.signals)) {
      await tx.run(insertHookSql, [release.id, signalId, value, ingestSource, nowIso()]);
    }
  });

  await writeAudit({
    workspaceId: release.workspace_id,
    releaseId: release.id,
    eventType: "INTEGRATION_SIGNALS_MAPPED",
    actorType: "SYSTEM",
    actorName: ingestSource,
    details: {
      provider: String(provider),
      ingest_mode: "workspace_webhook",
      mapped_signal_ids: Object.keys(mapped.signals)
    }
  });

  const out = await evaluateReleaseAfterSignalIngest(release, release.id, ingestSource, Object.keys(mapped.signals).length);
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
};
