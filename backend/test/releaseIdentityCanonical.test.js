"use strict";

/**
 * One release per workspace + commit across the label trigger, create_release,
 * and the CI webhook (docs/STATE_MACHINES.md §3, issue F).
 */

require("./helpers/backendFixtures");

const crypto = require("crypto");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { queryOne, queryAll, run } = require("../src/database");
const { createApp, ensureWorkspaceSeeded, signGithubPayload } = require("./helpers/backendFixtures");
const { openReleaseSession } = require("../src/services/releaseIdentity");
const { nowIso } = require("../src/lib/time");

function sha40() {
  return crypto.randomBytes(20).toString("hex");
}

async function freshWorkspace() {
  const ws = `ws_ident_${crypto.randomBytes(4).toString("hex")}`;
  await ensureWorkspaceSeeded(ws);
  return ws;
}

function labelOpen(ws, sha, { prNumber = 41, owner = "acme", repo = "app", label = "verdikt:rc" } = {}) {
  return openReleaseSession({
    workspaceId: ws,
    version: `Label PR (#${prNumber})`,
    releaseRef: `Label PR (#${prNumber})`,
    releaseType: "model_update",
    source: "github_label",
    idempotencyKey: `github:${owner}/${repo}:pr:${prNumber}:sha:${sha}:label:${label}`,
    commitSha: sha,
    prNumber,
    githubOwner: owner,
    githubRepo: repo
  });
}

function agentOpen(ws, sha, { prNumber = 41, owner = "acme", repo = "app" } = {}) {
  return openReleaseSession({
    workspaceId: ws,
    version: "agent-create-release",
    releaseRef: "agent-create-release",
    releaseType: "model_update",
    source: "agent",
    auditEventType: "RELEASE_CREATED",
    commitSha: sha,
    prNumber,
    githubOwner: owner,
    githubRepo: repo
  });
}

function ciOpen(ws, sha) {
  return openReleaseSession({
    workspaceId: ws,
    version: `ci@${sha.slice(0, 8)}`,
    releaseRef: `ci@${sha.slice(0, 8)}`,
    releaseType: "model_update",
    source: "ci_webhook",
    commitSha: sha
  });
}

async function releaseCount(ws) {
  const row = await queryOne("SELECT COUNT(*)::int AS c FROM releases WHERE workspace_id = $1", [ws]);
  return row.c;
}

describe("canonical release identity per workspace + commit", () => {
  it("create_release after the label trigger reuses the label's release", async () => {
    const ws = await freshWorkspace();
    const sha = sha40();
    const label = await labelOpen(ws, sha);
    const agent = await agentOpen(ws, sha);
    assert.equal(label.reused, false);
    assert.equal(agent.reused, true);
    assert.equal(agent.release.id, label.release.id);
    assert.equal(await releaseCount(ws), 1);
  });

  it("the label trigger after create_release reuses the agent's release", async () => {
    const ws = await freshWorkspace();
    const sha = sha40();
    const agent = await agentOpen(ws, sha);
    const label = await labelOpen(ws, sha);
    assert.equal(label.reused, true);
    assert.equal(label.release.id, agent.release.id);
    assert.equal(await releaseCount(ws), 1);
  });

  it("concurrent label, create_release, and CI webhook opens create one release", async () => {
    const ws = await freshWorkspace();
    const sha = sha40();
    const results = await Promise.all([
      labelOpen(ws, sha),
      agentOpen(ws, sha),
      ciOpen(ws, sha),
      labelOpen(ws, sha),
      agentOpen(ws, sha),
      ciOpen(ws, sha)
    ]);
    assert.equal(new Set(results.map((r) => r.release.id)).size, 1);
    assert.equal(results.filter((r) => !r.reused).length, 1);
    assert.equal(await releaseCount(ws), 1);
  });

  it("reuses a release opened before canonical keys existed, including by SHA prefix", async () => {
    const ws = await freshWorkspace();
    const sha = sha40();
    const legacyId = `rel_legacy_${crypto.randomBytes(4).toString("hex")}`;
    const ts = nowIso();
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at,
                             commit_sha, pr_number, github_owner, github_repo)
       VALUES ($1, $2, 'legacy', 'model_update', 'pre-prod', 'UNCERTIFIED', $3, $3, $4, 41, 'acme', 'app')`,
      [legacyId, ws, ts, sha]
    );
    await run("INSERT INTO webhook_events (idempotency_key, release_id, created_at) VALUES ($1, $2, $3)", [
      `github:acme/app:pr:41:sha:${sha}:label:verdikt:rc`,
      legacyId,
      ts
    ]);

    const agent = await agentOpen(ws, sha);
    assert.equal(agent.reused, true);
    assert.equal(agent.release.id, legacyId);

    const short = await ciOpen(ws, sha.slice(0, 12));
    assert.equal(short.reused, true);
    assert.equal(short.release.id, legacyId);
    assert.equal(await releaseCount(ws), 1);
  });

  it("keeps workspaces separate for the same commit", async () => {
    const sha = sha40();
    const a = await agentOpen(await freshWorkspace(), sha);
    const b = await agentOpen(await freshWorkspace(), sha);
    assert.equal(a.reused, false);
    assert.equal(b.reused, false);
    assert.notEqual(a.release.id, b.release.id);
  });

  it("a new commit still opens a new release", async () => {
    const ws = await freshWorkspace();
    const first = await labelOpen(ws, sha40());
    const second = await labelOpen(ws, sha40());
    assert.notEqual(first.release.id, second.release.id);
    assert.equal(await releaseCount(ws), 2);
  });
});

describe("HTTP surfaces of canonical release identity", () => {
  const app = createApp();

  async function connectedWorkspace(repo) {
    const email = `ident_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "IDENT" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    await human
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    return { ws, human };
  }

  function postGithub(payload) {
    const signed = signGithubPayload(payload);
    return request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw);
  }

  it("POST /releases reuse describes the stored release, not the request", async () => {
    const repo = `IdentRepo${crypto.randomBytes(3).toString("hex")}`;
    const { ws, human } = await connectedWorkspace(repo);
    const sha = sha40();
    const first = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "stored-version", release_type: "model_update", commit_sha: sha, pr_number: 51 })
      .expect(201);
    await run("UPDATE releases SET environment = 'prod', callback_url = NULL WHERE id = $1", [first.body.id]);

    const reused = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({
        version: "request-version",
        release_type: "prompt_update",
        commit_sha: sha,
        pr_number: 51,
        callback_url: "https://example.com/callback"
      })
      .expect(200);
    assert.equal(reused.body.reused, true);
    assert.equal(reused.body.id, first.body.id);
    assert.equal(reused.body.version, "stored-version");
    assert.equal(reused.body.release_type, "model_update");
    assert.equal(reused.body.environment, "prod");
    assert.equal(reused.body.callback_url, null);
  });

  it("merging a second PR with the same head commit promotes the shared release", async () => {
    const repo = `IdentMerge${crypto.randomBytes(3).toString("hex")}`;
    const { ws, human } = await connectedWorkspace(repo);
    const sha = sha40();
    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({
        version: "first-pr",
        release_type: "model_update",
        commit_sha: sha,
        pr_number: 71,
        github_owner: "useverdikt",
        github_repo: repo
      })
      .expect(201);

    const hook = await postGithub({
      action: "closed",
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 72, base: { ref: "main" }, head: { sha } }
    }).expect(200);
    assert.equal(hook.body.promoted, 1);

    const rows = await queryAll("SELECT id, environment FROM releases WHERE workspace_id = $1", [ws]);
    assert.deepEqual(rows, [{ id: created.body.id, environment: "prod" }]);
  });
});
