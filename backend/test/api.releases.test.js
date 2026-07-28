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
const { getThresholdMap, computeVerdict } = require("../src/services/domain");
const { getMissingRequiredSignals } = require("../src/services/verdictEngine");
const { nowIso } = require("../src/lib/time");

describe("API releases / audit / thresholds", () => {
  const app = createApp();

  it("GET /detail returns expand payload without audit; full GET includes audit", async () => {
    const email = `det_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Det" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Detail split test", release_type: "model_update", environment: "pre-prod" })
      .expect(201);
    const relId = created.body.id;

    await agent
      .post(`/api/releases/${relId}/signals`)
      .send({ source: "simulator:test", signals: { accuracy: 90, safety: 95, tone: 90, hallucination: 95, relevance: 85 } })
      .expect(200);

    const detail = await agent.get(`/api/releases/${relId}/detail`).expect(200);
    assert.ok(Array.isArray(detail.body.signals));
    assert.ok(detail.body.release);
    assert.equal("audit" in detail.body, false);

    const full = await agent.get(`/api/releases/${relId}`).expect(200);
    assert.ok(Array.isArray(full.body.audit));
    assert.ok(full.body.signals.length >= 1);
  });
  it("loop-readiness returns cached on repeat request", async () => {
    const email = `lrc_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Lrc" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent.get(`/api/workspaces/${ws}/loop-readiness`).expect(200);
    const second = await agent.get(`/api/workspaces/${ws}/loop-readiness`).expect(200);
    assert.equal(second.body.cached, true);
  });
  it("GET /releases/:id/audit supports pagination", async () => {
    const email = `rau_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "RAu" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Release audit page", release_type: "model_update", environment: "pre-prod" })
      .expect(201);
    const relId = created.body.id;

    await agent
      .post(`/api/releases/${relId}/signals`)
      .send({ source: "test", signals: { accuracy: 90, safety: 95, tone: 90, hallucination: 95, relevance: 85 } })
      .expect(200);

    const page = await agent.get(`/api/releases/${relId}/audit?limit=5`).expect(200);
    assert.equal(page.body.release_id, relId);
    assert.ok(Array.isArray(page.body.events));
    assert.ok(page.body.events.length >= 1);
    assert.ok(page.body.events[0].event_type);
  });
  it("merged-to-main while collecting promotes immediately; verdict does not re-promote", async () => {
    const email = `ghpv_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHPV" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const repo = `PromoteAfterVerdict${crypto.randomBytes(3).toString("hex")}`;
    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Collect then promote (#8282)", release_type: "model_update", pr_number: 8282 })
      .expect(201);

    const mergePayload = {
      action: "closed",
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 8282, base: { ref: "main" } }
    };
    const signedMerge = signGithubPayload(mergePayload);
    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signedMerge.sig)
      .send(signedMerge.raw)
      .expect(200);
    assert.equal(hook.body.promoted, 1);
    assert.equal(hook.body.shipped_without_certification, 1);
    assert.equal(hook.body.environment, "prod");

    const relAfterMerge = await queryOne(
      "SELECT environment, status, shipped_without_certification FROM releases WHERE id = $1",
      [created.body.id]
    );
    assert.equal(relAfterMerge.environment, "prod");
    assert.equal(Number(relAfterMerge.shipped_without_certification), 1);

    await run("UPDATE releases SET collection_deadline = $1 WHERE id = $2", [
      new Date(Date.now() - 60_000).toISOString(),
      created.body.id
    ]);
    await agent
      .post(`/api/releases/${created.body.id}/signals`)
      .send({
        source: "test",
        signals: {
          accuracy: 90,
          safety: 95,
          tone: 90,
          hallucination: 95,
          relevance: 85
        }
      })
      .expect(200);

    const rel = await queryOne(
      "SELECT environment, status, shipped_without_certification FROM releases WHERE id = $1",
      [created.body.id]
    );
    assert.equal(rel.environment, "prod");
    assert.equal(rel.status, "CERTIFIED");
    assert.equal(Number(rel.shipped_without_certification), 1);
  });
  it("manual release creation always starts in pre-prod", async () => {
    const email = `env_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "ENV" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-env-guard-1", release_type: "model_update", environment: "prod" })
      .expect(201);

    assert.equal(created.body.environment, "pre-prod");
    const rel = await queryOne("SELECT environment FROM releases WHERE id = $1", [created.body.id]);
    assert.equal(rel.environment, "pre-prod");
  });
  it("extends collection deadline for COLLECTING releases", async () => {
    const email = `extend_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "EXT" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-extend-deadline-1", release_type: "model_update" })
      .expect(201);
    assert.equal(created.body.status, "COLLECTING");
    const before = await queryOne("SELECT collection_deadline FROM releases WHERE id = $1", [created.body.id]);
    assert.ok(before.collection_deadline);

    const extended = await agent
      .post(`/api/releases/${created.body.id}/collection-deadline/extend`)
      .send({ extend_minutes: 10 })
      .expect(200);
    assert.ok(extended.body.collection_deadline);
    assert.equal(extended.body.extend_minutes, 10);
    assert.ok(Date.parse(extended.body.collection_deadline) > Date.parse(before.collection_deadline));

    const after = await queryOne("SELECT collection_deadline FROM releases WHERE id = $1", [created.body.id]);
    assert.equal(after.collection_deadline, extended.body.collection_deadline);

    await run("UPDATE releases SET status = 'CERTIFIED' WHERE id = $1", [created.body.id]);
    await agent.post(`/api/releases/${created.body.id}/collection-deadline/extend`).send({ extend_minutes: 5 }).expect(409);
  });
  it("required signals gate certification regardless of integration connection", async () => {
    const email = `scope_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Scope" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/signal-integrations/braintrust`)
      .send({ apiKey: "bt_scope_key" })
      .expect(200);

    await agent
      .post(`/api/workspaces/${ws}/thresholds`)
      .send({
        thresholds: {
          smoke: { min: 100, max: null, required_for_certification: true },
          crashrate: { min: null, max: 0.1, required_for_certification: true },
          accuracy: { min: 85, max: null, required_for_certification: true }
        }
      })
      .expect(200);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-scope-1", release_type: "model_patch" })
      .expect(201);

    const missing = await getMissingRequiredSignals(ws, created.body.id, {}, created.body);
    assert.ok(missing.includes("accuracy"));
    assert.ok(missing.includes("smoke"));
    assert.ok(missing.includes("crashrate"));
    assert.ok(!missing.includes("e2e_regression"));
  });
  it("legacy crashrate min rows normalize and low values pass threshold", async () => {
    const email = `thr_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Thr" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await run(
      "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification) VALUES ($1, $2, $3, $4, 1) ON CONFLICT(workspace_id, signal_id) DO UPDATE SET min_value=excluded.min_value, max_value=excluded.max_value, required_for_certification=excluded.required_for_certification",
      [ws, "crashrate", 0.1, null]
    );

    const map = await getThresholdMap(ws);
    assert.equal(map.crashrate.max, 0.1);
    assert.equal(map.crashrate.min, null);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-crash-thr", release_type: "model_update" })
      .expect(201);

    await agent
      .put(`/api/workspaces/${ws}/signal-integrations/sentry`)
      .send({ apiKey: "sentry_scope_key" })
      .expect(200);

    const verdict = await computeVerdict(ws, created.body.id, { crashrate: 0.01 }, created.body);
    assert.equal(
      verdict.failed_signals.filter((f) => f.signal_id === "crashrate").length,
      0
    );
  });
});
