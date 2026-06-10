"use strict";

const {
  authMiddleware,
  requireWorkspaceMatch,
  resolveReleaseForWorkspaceIngest,
  normalizeCommitSha
} = require("../deps");
const { buildReleaseGateResponse } = require("../../services/releaseGate");

module.exports = function registerRoutes(app) {
  /**
   * CI-friendly gate: resolve release by commit SHA (no release_id required).
   * Use in GitHub Actions after verdikt:rc opens the cert window for this commit.
   *
   * GET /api/workspaces/:workspaceId/gate?commit_sha=abc123&github_owner=org&github_repo=repo&pr_number=42&mode=strict
   */
  app.get("/api/workspaces/:workspaceId/gate", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
    try {
      const commit_sha = normalizeCommitSha(String(req.query.commit_sha || ""));
      if (!commit_sha) {
        return res.status(400).json({ error: "commit_sha query parameter is required (7+ hex chars)" });
      }

      const github_owner = req.query.github_owner ? String(req.query.github_owner).trim() : null;
      const github_repo = req.query.github_repo ? String(req.query.github_repo).trim() : null;
      const prRaw = req.query.pr_number;
      const pr_number =
        prRaw != null && String(prRaw).trim() !== "" && Number.isFinite(Number(prRaw)) ? Number(prRaw) : null;

      const mode =
        req.query.mode === "strict" ? "strict" : req.query.mode === "default" ? "default" : undefined;

      const release = await resolveReleaseForWorkspaceIngest(req.params.workspaceId, {
        commit_sha,
        pr_number,
        github_owner,
        github_repo,
        prefer_collecting: true
      });

      if (!release) {
        return res.status(404).json({
          error: "no release found for commit_sha",
          commit_sha,
          hint: "Apply verdikt:rc on the PR (or create_release with this SHA) before calling gate"
        });
      }

      const payload = await buildReleaseGateResponse(release, { mode, auth: req.auth });
      return res.json(payload);
    } catch (e) {
      next(e);
    }
  });
};
