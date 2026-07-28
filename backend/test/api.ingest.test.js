"use strict";

/**
 * Split from former backend.test.js — domain suite.
 */

require("./helpers/backendFixtures");

const crypto = require("crypto");
const { describe, it, after, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { queryOne, run } = require("../src/database");
const {
  createApp,
  ensureWorkspaceSeeded,
  writeAudit,
  seedDefaultThresholdsForTest,
  setUserRole,
  signGithubPayload,
  waitForAuditEvent,
  waitForAuditEventCount
} = require("./helpers/backendFixtures");
const { getThresholdMap } = require("../src/services/domain");
const { nowIso } = require("../src/lib/time");

describe("API ingest / integrations / GitHub", () => {
  const app = createApp();

  it("signal-integrations: PUT verifies (skipped in test) and lists", async () => {
    const email = `sig_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Sig" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const put = await agent
      .put(`/api/workspaces/${ws}/signal-integrations/sentry`)
      .send({ apiKey: "sntry_test_fake_token_for_ci_xxxxxxxx" })
      .expect(200);
    assert.ok(put.body.masked_key);
    assert.ok(put.body.verified_at);

    const list = await agent.get(`/api/workspaces/${ws}/signal-integrations`).expect(200);
    assert.equal(list.body.integrations.length, 1);
    assert.equal(list.body.integrations[0].source_id, "sentry");

    await agent.delete(`/api/workspaces/${ws}/signal-integrations/sentry`).expect(200);

    const empty = await agent.get(`/api/workspaces/${ws}/signal-integrations`).expect(200);
    assert.equal(empty.body.integrations.length, 0);
  });
  it("signal-integrations panel includes pull_connectors and integration-requests POST", async () => {
    const email = `panel_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Panel" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const list = await agent.get(`/api/workspaces/${ws}/signal-integrations`).expect(200);
    assert.ok(Array.isArray(list.body.pull_connectors));
    assert.ok(list.body.pull_connectors.some((c) => c.source_id === "langsmith"));
    assert.ok(list.body.api_push?.ingest_path);

    const req = await agent
      .post(`/api/workspaces/${ws}/integration-requests`)
      .send({ source_name: "W&B", notes: "Eval metrics" })
      .expect(201);
    assert.equal(req.body.source_name, "W&B");
    assert.equal(req.body.status, "pending");

    const after = await agent.get(`/api/workspaces/${ws}/signal-integrations`).expect(200);
    assert.equal(after.body.integration_requests.length, 1);
    assert.equal(after.body.integration_requests[0].source_name, "W&B");
  });
  it("datadog integration rejects unsupported site (SSRF guard)", async () => {
    const email = `dd_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "DD" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const bad = await agent
      .put(`/api/workspaces/${ws}/signal-integrations/datadog`)
      .send({ apiKey: "dd_test_api_key", appKey: "dd_test_app_key", site: "evil.example.com" })
      .expect(400);
    assert.match(bad.body.message || bad.body.error, /Unsupported Datadog site/i);

    const ok = await agent
      .put(`/api/workspaces/${ws}/signal-integrations/datadog`)
      .send({ apiKey: "dd_test_api_key", appKey: "dd_test_app_key", site: "datadoghq.eu" })
      .expect(200);
    assert.equal(ok.body.source_id, "datadog");
  });
  it("github label trigger config can be set and cleared", async () => {
    const email = `ghcfg_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GH" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const initial = await agent.get(`/api/workspaces/${ws}/github-label-trigger`).expect(200);
    assert.equal(initial.body.enabled, false);
    assert.equal(initial.body.label_name, "verdikt:rc");

    const saved = await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "release:certify", enabled: true })
      .expect(200);
    assert.equal(saved.body.enabled, true);
    assert.equal(saved.body.label_name, "release:certify");

    const cleared = await agent.delete(`/api/workspaces/${ws}/github-label-trigger`).expect(200);
    assert.equal(cleared.body.ok, true);

    const afterDelete = await agent.get(`/api/workspaces/${ws}/github-label-trigger`).expect(200);
    assert.equal(afterDelete.body.enabled, false);
    assert.equal(afterDelete.body.label_name, "verdikt:rc");
  });
  it("GitHub label trigger uses PR title and auto-classifies release type", async () => {
    // Use random PR number and SHA so repeated test runs don't hit the stable idempotency key.
    const prNumber = 40000 + crypto.randomInt(9999);
    const sha = crypto.randomBytes(8).toString("hex");
    const email = `ght_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const repo = `VerdiktTitle${crypto.randomBytes(3).toString("hex")}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHT" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "verdikt:rc", enabled: true })
      .expect(200);

    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: {
        number: prNumber,
        title: "Safety hotfix for policy routing",
        html_url: `https://github.com/useverdikt/${repo}/pull/${prNumber}`,
        labels: [{ name: "safety" }],
        head: { sha, ref: "fix/safety-routing" }
      }
    };
    const signed = signGithubPayload(payload);

    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(201);

    const rel = await queryOne("SELECT * FROM releases WHERE id = $1", [hook.body.release_id]);
    assert.equal(rel.workspace_id, ws);
    assert.equal(rel.version, `Safety hotfix for policy routing (#${prNumber})`);
    assert.equal(rel.release_type, "safety_patch");
    assert.equal(rel.environment, "pre-prod");
    assert.equal(Number(rel.pr_number), prNumber);
    const aiContext = JSON.parse(rel.ai_context_json || "{}");
    assert.equal(aiContext.legacy_release_ref, `pr/${prNumber}@${sha.slice(0, 8)}`);
    assert.equal(aiContext.release_type_auto, "safety_patch");
  });
  it("GitHub label trigger falls back to legacy PR ref when title is missing", async () => {
    const prNumber = 50000 + crypto.randomInt(9999);
    const sha = crypto.randomBytes(8).toString("hex");
    const email = `ghf_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const repo = `FallbackTitle${crypto.randomBytes(3).toString("hex")}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHF" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "verdikt:rc", enabled: true })
      .expect(200);

    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: {
        number: prNumber,
        title: "",
        html_url: `https://github.com/useverdikt/${repo}/pull/${prNumber}`,
        labels: [],
        head: { sha, ref: "feature/no-title" }
      }
    };
    const signed = signGithubPayload(payload);

    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(201);

    const rel = await queryOne("SELECT * FROM releases WHERE id = $1", [hook.body.release_id]);
    assert.equal(rel.version, `pr/${prNumber}@${sha.slice(0, 8)}`);
    assert.equal(rel.release_type, "model_update");
  });
  it("GitHub label trigger deduplicates repeated deliveries for the same PR commit", async () => {
    const prNumber = 90000 + crypto.randomInt(9999);
    const sha = crypto.randomBytes(8).toString("hex");
    const email = `ghd_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const repo = `DedupRepo${crypto.randomBytes(3).toString("hex")}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHD" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "verdikt:rc", enabled: true })
      .expect(200);

    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: {
        number: prNumber,
        title: "Duplicate delivery dedupe check",
        html_url: `https://github.com/useverdikt/${repo}/pull/${prNumber}`,
        labels: [{ name: "verdikt:rc" }],
        head: { sha, ref: "fix/dedupe" }
      }
    };
    const signed = signGithubPayload(payload);

    const first = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(201);

    const second = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(200);

    assert.equal(second.body.reused, true);
    assert.equal(second.body.release_id, first.body.release_id);

    const count = await queryOne(
      "SELECT COUNT(*) AS c FROM releases WHERE workspace_id = $1 AND pr_number = $2 AND commit_sha = $3",
      [ws, prNumber, sha]
    );
    assert.equal(Number(count?.c || 0), 1);
  });
  it("GitHub label trigger schedules async integration pull from connected sources", async () => {
    const prNumber = 95000 + crypto.randomInt(9999);
    const sha = crypto.randomBytes(8).toString("hex");
    const email = `ghpull_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const repo = `PullOnLabel${crypto.randomBytes(3).toString("hex")}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHPull" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "verdikt:rc", enabled: true })
      .expect(200);
    await agent.put(`/api/workspaces/${ws}/signal-integrations/braintrust`).send({ apiKey: "bt_test_mock_key" }).expect(200);

    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: {
        number: prNumber,
        title: "Auto pull on label",
        html_url: `https://github.com/useverdikt/${repo}/pull/${prNumber}`,
        labels: [{ name: "verdikt:rc" }],
        head: { sha, ref: "feat/auto-pull" }
      }
    };
    const signed = signGithubPayload(payload);

    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(201);

    const audit = await waitForAuditEvent(hook.body.release_id, "SIGNAL_SOURCES_PULL");
    assert.ok(audit, "expected async SIGNAL_SOURCES_PULL audit after label trigger");
    assert.equal(audit.actor_type, "SYSTEM");
    assert.equal(audit.actor_name, "github_label_trigger");
    const details = JSON.parse(audit.details_json || "{}");
    assert.equal(details.trigger, "github_label");
    assert.equal(details.async, true);
    assert.ok(Array.isArray(details.sources));

    const signalCount = await queryOne(
      "SELECT COUNT(*) AS c FROM signals WHERE release_id = $1 AND source = $2",
      [hook.body.release_id, "pulled:braintrust"]
    );
    assert.ok(Number(signalCount?.c || 0) > 0);

    const reused = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(200);

    assert.equal(reused.body.reused, true);
    const pullCount = await waitForAuditEventCount(hook.body.release_id, "SIGNAL_SOURCES_PULL", 2);
    assert.ok(pullCount >= 2, `expected 2 async pulls on reuse, got ${pullCount}`);
  });
  it("GitHub label trigger deduplicates concurrent simultaneous deliveries (race condition)", async () => {
    const prNumber = 70000 + crypto.randomInt(9999);
    const sha = crypto.randomBytes(8).toString("hex");
    const repo = `RaceRepo${crypto.randomBytes(3).toString("hex")}`;
    const email = `ghrace_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHRACE" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "verdikt:rc", enabled: true })
      .expect(200);

    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: {
        number: prNumber,
        title: "Race condition check",
        html_url: `https://github.com/useverdikt/${repo}/pull/${prNumber}`,
        labels: [{ name: "verdikt:rc" }],
        head: { sha, ref: "fix/race" }
      }
    };
    const signed = signGithubPayload(payload);

    // Fire both requests simultaneously — only one should create a release.
    const [r1, r2] = await Promise.all([
      request(app)
        .post("/api/hooks/github")
        .set("content-type", "application/json")
        .set("x-github-event", "pull_request")
        .set("x-github-delivery", `race-a-${crypto.randomBytes(4).toString("hex")}`)
        .set("x-hub-signature-256", signed.sig)
        .send(signed.raw),
      request(app)
        .post("/api/hooks/github")
        .set("content-type", "application/json")
        .set("x-github-event", "pull_request")
        .set("x-github-delivery", `race-b-${crypto.randomBytes(4).toString("hex")}`)
        .set("x-hub-signature-256", signed.sig)
        .send(signed.raw),
    ]);

    assert.ok([200, 201].includes(r1.status), `r1 status ${r1.status}`);
    assert.ok([200, 201].includes(r2.status), `r2 status ${r2.status}`);
    const count = await queryOne(
      "SELECT COUNT(*) AS c FROM releases WHERE workspace_id = $1 AND pr_number = $2 AND commit_sha = $3",
      [ws, prNumber, sha]
    );
    assert.equal(Number(count?.c || 0), 1, "exactly one release row should exist");
    const created = [r1, r2].filter((r) => r.status === 201);
    const reused = [r1, r2].filter((r) => r.status === 200 && r.body.reused);
    assert.equal(created.length + reused.length, 2, "both deliveries should succeed");
    assert.equal(created.length, 1, "exactly one release should be created");
    assert.equal(reused.length, 1, "exactly one should be marked reused");
    const releaseId = created[0]?.body?.release_id || reused[0]?.body?.release_id;
    assert.ok(releaseId, "expected a release_id on create or reuse response");
    if (created[0]?.body?.release_id && reused[0]?.body?.release_id) {
      assert.equal(reused[0].body.release_id, created[0].body.release_id);
    }
  });
  it("GitHub merge promotes to prod and flags shipped_without_certification while collecting", async () => {
    const email = `ghb_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHB" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo: "PromoteBlock" })
      .expect(200);
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Collecting PR (#6161)", release_type: "model_update", environment: "pre-prod", pr_number: 6161 })
      .expect(201);

    const payload = {
      action: "closed",
      repository: { name: "PromoteBlock", owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 6161, base: { ref: "main" } }
    };
    const signed = signGithubPayload(payload);
    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(200);

    assert.equal(hook.body.promoted, 1);
    assert.equal(hook.body.shipped_without_certification, 1);
    assert.equal(hook.body.environment, "prod");
    const rel = await queryOne(
      "SELECT environment, shipped_without_certification, shipped_without_certification_at FROM releases WHERE id = $1",
      [created.body.id]
    );
    assert.equal(rel.environment, "prod");
    assert.equal(Number(rel.shipped_without_certification), 1);
    assert.ok(rel.shipped_without_certification_at);
    const bypassAudit = await queryOne(
      "SELECT * FROM audit_events WHERE release_id = $1 AND event_type = $2 ORDER BY id DESC LIMIT 1",
      [created.body.id, "RELEASE_SHIPPED_WITHOUT_CERTIFICATION"]
    );
    assert.ok(bypassAudit);
    const promotedAudit = await queryOne(
      "SELECT * FROM audit_events WHERE release_id = $1 AND event_type = $2 ORDER BY id DESC LIMIT 1",
      [created.body.id, "RELEASE_ENV_PROMOTED"]
    );
    assert.ok(promotedAudit);
  });
  it("duplicate signal idempotency key replays read-only without new audit events", async () => {
    const email = `dup_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Dup" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Idempotency replay test", release_type: "model_update", environment: "pre-prod" })
      .expect(201);
    const relId = created.body.id;
    const idempotencyKey = `dup-key-${crypto.randomBytes(4).toString("hex")}`;
    const payload = {
      source: "test",
      idempotency_key: idempotencyKey,
      signals: { accuracy: 90, safety: 95, tone: 90, hallucination: 95, relevance: 85 }
    };

    await agent.post(`/api/releases/${relId}/signals`).send(payload).expect(200);
    const auditBefore = await queryOne("SELECT COUNT(*) AS c FROM audit_events WHERE release_id = $1", [relId]);

    const replay = await agent.post(`/api/releases/${relId}/signals`).send(payload).expect(200);
    assert.equal(replay.body.duplicate, true);
    assert.equal(replay.body.release_id, relId);

    const auditAfter = await queryOne("SELECT COUNT(*) AS c FROM audit_events WHERE release_id = $1", [relId]);
    assert.equal(Number(auditAfter.c), Number(auditBefore.c));
  });
  it("GitHub merge promotes to prod after verdict is issued", async () => {
    const email = `ghp_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHP" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo: "PromoteOk" })
      .expect(200);
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Certified PR (#7171)", release_type: "model_update", environment: "pre-prod", pr_number: 7171 })
      .expect(201);
    await run("UPDATE releases SET status = $1, verdict_issued_at = $2 WHERE id = $3", ["CERTIFIED", nowIso(), created.body.id]);

    const payload = {
      action: "closed",
      repository: { name: "PromoteOk", owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 7171, base: { ref: "main" } }
    };
    const signed = signGithubPayload(payload);
    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(200);

    assert.equal(hook.body.promoted, 1);
    assert.equal(hook.body.shipped_without_certification, 0);
    assert.equal(hook.body.environment, "prod");
    const rel = await queryOne("SELECT environment FROM releases WHERE id = $1", [created.body.id]);
    assert.equal(rel.environment, "prod");
  });
  it("RLS is enabled for public GitHub config tables", async () => {
    const tables = [
      "workspace_inbound_webhook_secrets",
      "github_label_triggers",
      "github_app_installations",
      "github_app_install_states",
      "github_repo_connections"
    ];
    for (const table of tables) {
      const row = await queryOne(
        "SELECT relrowsecurity AS enabled FROM pg_class WHERE oid = $1::regclass",
        [`public.${table}`]
      );
      assert.equal(row.enabled, true, `${table} should have RLS enabled`);
    }
  });
  it("CSV import stores rows and applies signals to release by version", async () => {
    const email = `csv_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "CSV" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-csv-apply-1", release_type: "model_update" })
      .expect(201);

    const csvBody = "version,accuracy,safety\nv-csv-apply-1,91,90\n";
    const up = await agent
      .post(`/api/workspaces/${ws}/signal-csv-imports`)
      .attach("file", Buffer.from(csvBody, "utf8"), "signals.csv")
      .expect(200);
    assert.equal(up.body.row_count, 1);
    assert.equal(up.body.apply_result.applied, true);
    assert.ok(Array.isArray(up.body.apply_result.releases));
    assert.equal(up.body.apply_result.releases.length, 1);
  });
  it("POST release sources pull invokes Braintrust path in test (mock metrics)", async () => {
    const email = `pl_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Pull" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-pull-mock-1", release_type: "model_update" })
      .expect(201);

    const list = await agent.get(`/api/workspaces/${ws}/releases`).expect(200);
    const releaseId = list.body.releases[0].id;

    await agent.put(`/api/workspaces/${ws}/signal-integrations/braintrust`).send({ apiKey: "bt_test_mock_key" }).expect(200);

    const pull = await agent.post(`/api/releases/${releaseId}/sources/pull`).expect(200);
    assert.equal(pull.body.ok, true);
    assert.equal(pull.body.sources.braintrust.ok, true);
  });
  it("POST release sources pull invokes BrowserStack path in test (mock metrics)", async () => {
    const email = `bs_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "BSPull" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-bs-pull-1", release_type: "prompt_update" })
      .expect(201);

    await agent
      .put(`/api/workspaces/${ws}/signal-integrations/browserstack`)
      .send({ username: "bs_user", apiKey: "bs_test_key" })
      .expect(200);

    const pull = await agent.post(`/api/releases/${created.body.id}/sources/pull`).expect(200);
    assert.equal(pull.body.ok, true);
    assert.equal(pull.body.sources.browserstack.ok, true);
  });
});
