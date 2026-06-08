"use strict";

const {
  writeAudit,
  authMiddleware,
  requireNonViewer,
  requireWorkspaceMatch,
  getVcsIntegration,
  setVcsIntegration,
  deleteVcsIntegration,
  DEFAULT_GITHUB_LABEL_NAME,
  getGithubLabelTrigger,
  setGithubLabelTrigger,
  deleteGithubLabelTrigger,
  hasGithubAppConfig,
  createInstallState,
  getWorkspaceInstallation,
  listWorkspaceConnectedRepos,
  replaceWorkspaceConnectedRepos,
  listInstallationRepos
} = require("../deps");

module.exports = function registerRoutes(app) {
app.get("/api/workspaces/:workspaceId/vcs-integration", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const cfg = await getVcsIntegration(req.params.workspaceId);
    if (!cfg) return res.status(404).json({ error: "no VCS integration configured" });
    return res.json({ ...cfg, access_token: "***" });
  } catch (e) {
    next(e);
  }
});

app.put("/api/workspaces/:workspaceId/vcs-integration", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
  const { provider, access_token, owner, repo } = req.body || {};
  try {
    await setVcsIntegration(req.params.workspaceId, { provider, access_token, owner, repo });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  writeAudit({ workspaceId: req.params.workspaceId, eventType: "VCS_INTEGRATION_CONFIGURED", actorType: "USER", actorName: req.auth?.email || "user", details: { provider, owner, repo } });
  const cfg = await getVcsIntegration(req.params.workspaceId);
  return res.json({ ...cfg, access_token: "***" });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/workspaces/:workspaceId/vcs-integration", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
  await deleteVcsIntegration(req.params.workspaceId);
  writeAudit({ workspaceId: req.params.workspaceId, eventType: "VCS_INTEGRATION_REMOVED", actorType: "USER", actorName: req.auth?.email || "user", details: {} });
  return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/github-label-trigger", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const cfg = await getGithubLabelTrigger(req.params.workspaceId);
    return res.json(cfg);
  } catch (e) {
    next(e);
  }
});

app.put("/api/workspaces/:workspaceId/github-label-trigger", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const { label_name, enabled } = req.body || {};
    const out = await setGithubLabelTrigger(req.params.workspaceId, {
      label_name: typeof label_name === "string" && label_name.trim() ? label_name.trim() : DEFAULT_GITHUB_LABEL_NAME,
      enabled: enabled !== false
    });
    await writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "GITHUB_LABEL_TRIGGER_CONFIGURED",
      actorType: "USER",
      actorName: req.auth?.email || "user",
      details: { label_name: out.label_name, enabled: out.enabled }
    });
    return res.json(out);
  } catch (e) {
    next(e);
  }
});

app.delete("/api/workspaces/:workspaceId/github-label-trigger", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    await deleteGithubLabelTrigger(req.params.workspaceId);
    await writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "GITHUB_LABEL_TRIGGER_REMOVED",
      actorType: "USER",
      actorName: req.auth?.email || "user",
      details: {}
    });
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/github-app/status", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const installation = await getWorkspaceInstallation(req.params.workspaceId);
    const repos = await listWorkspaceConnectedRepos(req.params.workspaceId);
    return res.json({
      configured: hasGithubAppConfig(),
      connected: !!installation,
      installation: installation
        ? {
            installation_id: Number(installation.installation_id),
            account_login: installation.account_login || null,
            account_type: installation.account_type || null,
            updated_at: installation.updated_at
          }
        : null,
      selected_repo_count: repos.length
    });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/github-app/connect", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    if (!hasGithubAppConfig()) {
      return res.status(503).json({ error: "GitHub App is not configured on server" });
    }
    const out = await createInstallState(req.params.workspaceId, req.auth?.sub || null);
    return res.json(out);
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/github-app/repos", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const installation = await getWorkspaceInstallation(req.params.workspaceId);
    if (!installation) {
      return res.status(404).json({ error: "GitHub App is not connected for this workspace" });
    }
    const [availableRepos, connectedRepos] = await Promise.all([
      listInstallationRepos(Number(installation.installation_id)),
      listWorkspaceConnectedRepos(req.params.workspaceId)
    ]);
    const selectedById = new Set(connectedRepos.map((r) => Number(r.repository_id)));
    return res.json({
      workspace_id: req.params.workspaceId,
      installation: {
        installation_id: Number(installation.installation_id),
        account_login: installation.account_login || null,
        account_type: installation.account_type || null
      },
      repos: availableRepos.map((r) => ({
        repository_id: Number(r.id),
        owner: r?.owner?.login || "",
        repo: r?.name || "",
        full_name: r?.full_name || "",
        private: r?.private === true,
        selected: selectedById.has(Number(r.id))
      }))
    });
  } catch (e) {
    next(e);
  }
});

app.put("/api/workspaces/:workspaceId/github-app/repos", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const repos = Array.isArray(req.body?.repos) ? req.body.repos : [];
    const saved = await replaceWorkspaceConnectedRepos(req.params.workspaceId, repos);
    await writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "GITHUB_REPOS_CONNECTED",
      actorType: "USER",
      actorName: req.auth?.email || "user",
      details: { repository_count: saved.length, repos: saved.map((r) => r.full_name) }
    });
    return res.json({ ok: true, repos: saved });
  } catch (e) {
    next(e);
  }
});
};
