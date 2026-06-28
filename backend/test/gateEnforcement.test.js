"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";

const crypto = require("crypto");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { initDatabase, queryOne, run } = require("../src/database");
const { createApp } = require("../src/app");
const { ensureWorkspaceSeeded } = require("../src/services/domain");
const sharedPkg = require("../src/lib/sharedPkg");

let app;

async function seedDefaultThresholdsForTest(workspaceId) {
  await ensureWorkspaceSeeded(workspaceId);
  const countRow = await queryOne("SELECT COUNT(*) AS c FROM thresholds WHERE workspace_id = $1", [workspaceId]);
  if (Number(countRow?.c || 0) > 0) return;
  const defaults = sharedPkg.getDefaultThresholdSeedRows();
  const defaultRequired = new Set(sharedPkg.defaultRequiredSignalIds || []);
  const insertSql =
    "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification) VALUES ($1, $2, $3, $4, $5)";
  for (const row of defaults) {
    await run(insertSql, [workspaceId, row[0], row[1], row[2], defaultRequired.has(row[0]) ? 1 : 0]);
  }
}

async function setUserRole(userId, workspaceId, role) {
  await run("UPDATE users SET role = $1 WHERE id = $2", [role, userId]);
  await run("UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3", [role, workspaceId, userId]);
}

function assertGateBlocked(gate) {
  assert.equal(gate.can_merge, false, "can_merge must be false when merge is blocked");
  assert.equal(gate.gate.allowed, false);
  assert.equal(gate.gate.exit_code, 1, "exit_code must be 1 for branch protection fail");
  assert.notEqual(gate.action, "merge", "action must not be merge when blocked");
}

function assertGateOpen(gate) {
  assert.equal(gate.can_merge, true, "can_merge must be true when merge is allowed");
  assert.equal(gate.gate.allowed, true);
  assert.equal(gate.gate.exit_code, 0);
  assert.equal(gate.action, "merge");
}

before(async () => {
  await initDatabase();
  app = createApp();
});

describe("gate merge enforcement invariants", () => {
  it("UNCERTIFIED blocks merge: can_merge false, exit_code 1, action escalate", async () => {
    const email = `gateblk_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "GateBlk" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await seedDefaultThresholdsForTest(ws);

    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "gate-block-v1", release_type: "model_update" })
      .expect(201);

    await human
      .post(`/api/releases/${created.body.id}/signals`)
      .send({
        source: "test",
        signals: {
          accuracy: 50,
          safety: 95,
          tone: 90,
          hallucination: 95,
          relevance: 90,
          smoke: 100,
          e2e_regression: 100,
          manual_qa_pct: 100
        }
      })
      .expect(200);

    const gate = await human.get(`/api/releases/${created.body.id}/gate?mode=default`).expect(200);
    assert.equal(gate.body.status, "UNCERTIFIED");
    assertGateBlocked(gate.body);
    assert.equal(gate.body.action, "escalate");
    assert.ok(gate.body.blocking_signals.includes("accuracy"));
  });

  it("CERTIFIED opens merge: can_merge true, exit_code 0, action merge", async () => {
    const email = `gateopen_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "GateOpen" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await seedDefaultThresholdsForTest(ws);

    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "gate-open-v1", release_type: "model_update" })
      .expect(201);

    await human
      .post(`/api/releases/${created.body.id}/signals`)
      .send({
        source: "test",
        signals: {
          accuracy: 95,
          safety: 95,
          tone: 90,
          hallucination: 95,
          relevance: 90,
          smoke: 100,
          e2e_regression: 100,
          manual_qa_pct: 100
        }
      })
      .expect(200);

    const gate = await human.get(`/api/releases/${created.body.id}/gate?mode=default`).expect(200);
    assert.equal(gate.body.status, "CERTIFIED");
    assertGateOpen(gate.body);
  });

  it("CERTIFIED_WITH_OVERRIDE opens merge in default mode but stays blocked in strict", async () => {
    const email = `gateov_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "GateOv" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await setUserRole(me.body.user.id, ws, "vp_engineering");
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);

    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "gate-ov-v1", release_type: "model_update" })
      .expect(201);

    await human
      .post(`/api/releases/${created.body.id}/override`)
      .send({
        justification: "Hotfix waiver with monitoring plan in place for 24 hours.",
        metadata: {
          impact_summary: "Limited routing cohort only",
          mitigation_plan: "Rollback via feature flag if accuracy dips",
          follow_up_due_date: "2026-12-31"
        }
      })
      .expect(200);

    const defaultGate = await human.get(`/api/releases/${created.body.id}/gate?mode=default`).expect(200);
    assert.equal(defaultGate.body.status, "CERTIFIED_WITH_OVERRIDE");
    assertGateOpen(defaultGate.body);

    const strictGate = await human.get(`/api/releases/${created.body.id}/gate?mode=strict`).expect(200);
    assertGateBlocked(strictGate.body);
    assert.notEqual(strictGate.body.action, "merge");
  });

  it("workspace gate by SHA succeeds when prior certified releases exist (trajectory SQL)", async () => {
    const email = `gatetraj_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "GateTraj" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await seedDefaultThresholdsForTest(ws);

    const passingSignals = {
      accuracy: 95,
      safety: 95,
      tone: 90,
      hallucination: 95,
      relevance: 90,
      smoke: 100,
      e2e_regression: 100,
      manual_qa_pct: 100
    };

    const prior = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "gate-traj-prior", release_type: "model_update" })
      .expect(201);

    await human.post(`/api/releases/${prior.body.id}/signals`).send({ source: "test", signals: passingSignals }).expect(200);
    await human.get(`/api/releases/${prior.body.id}/gate?mode=default`).expect(200);

    const keyRes = await human.post(`/api/workspaces/${ws}/api-keys`).send({ name: "trajectory-gate" }).expect(201);
    const sha = crypto.randomBytes(20).toString("hex");
    const agent = request(app);

    const collecting = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({
        version: "gate-traj-collecting",
        release_type: "model_update",
        commit_sha: sha,
        pr_number: 99,
        github_owner: "acme",
        github_repo: "app"
      })
      .expect(201);

    const gate = await agent
      .get(`/api/workspaces/${ws}/gate`)
      .query({ commit_sha: sha, github_owner: "acme", github_repo: "app", pr_number: 99, mode: "default" })
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .expect(200);

    assert.equal(gate.body.release_id, collecting.body.id);
    assert.equal(gate.body.status, "COLLECTING");
    assert.ok(gate.body.gate.trajectory);
  });
});
