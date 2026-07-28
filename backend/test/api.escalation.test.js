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
  GEMINI_STUB,
  createApp,
  writeAudit,
  ensureWorkspaceSeeded,
  seedDefaultThresholdsForTest,
  setUserRole,
  signGithubPayload,
  waitForAuditEvent,
  waitForAuditEventCount
} = require("./helpers/backendFixtures");
const {
  computeVerdict,
  getThresholdMap,
  assessOverrideJustification,
  evaluateReleaseAfterSignalIngest
} = require("../src/services/domain");
const { getMissingRequiredSignals } = require("../src/services/verdictEngine");
const { analyzeReleaseDeltas } = require("../src/services/delta");
const sharedPkg = require("../src/lib/sharedPkg");
const { nowIso } = require("../src/lib/time");
const { maybeEnrichVerdictIntelligence } = require("../src/services/llmAssist");
const { callIntelligenceModel } = require("../src/services/aiClient");
const { upsertReleaseIntelligence, getReleaseIntelligence } = require("../src/services/intelligenceBuilder");
const { computeAndPersistRecommendation, getRecommendation } = require("../src/services/recommendationEngine");

describe("Escalation inbox", () => {
  const app = createApp();

  async function setUserRole(userId, workspaceId, role) {
    await run("UPDATE users SET role = $1 WHERE id = $2", [role, userId]);
    await run("UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3", [
      role,
      workspaceId,
      userId
    ]);
  }

  it("creates inbox row, lists pending, and acknowledges with override role", async () => {
    const email = `esc_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Esc" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await human
      .post(`/api/workspaces/${ws}/policies`)
      .send({ gate_mode: "strict", escalation_sla_hours: 48, escalation_notify_email: "ops@test.local" })
      .expect(200);

    const rel = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "esc-inbox-v1", release_type: "model_update" })
      .expect(201);

    const keyRes = await human.post(`/api/workspaces/${ws}/api-keys`).send({ name: "esc-agent" }).expect(201);
    const agent = request(app);
    const esc = await agent
      .post(`/api/releases/${rel.body.id}/escalate`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({ reason: "Blocked on accuracy", blocking_signals: ["accuracy"] })
      .expect(202);
    assert.ok(String(esc.body.escalation.id).startsWith("esc_"));

    const inbox = await human.get(`/api/workspaces/${ws}/escalations`).expect(200);
    assert.equal(inbox.body.escalations.length, 1);
    assert.equal(inbox.body.escalations[0].release_id, rel.body.id);

    await setUserRole(me.body.user.id, ws, "engineer");
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    await human.post(`/api/workspaces/${ws}/escalations/${esc.body.escalation.id}/acknowledge`).expect(403);

    await setUserRole(me.body.user.id, ws, "vp_engineering");
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const ack = await human
      .post(`/api/workspaces/${ws}/escalations/${esc.body.escalation.id}/acknowledge`)
      .send({ note: "Reviewed" })
      .expect(200);
    assert.equal(ack.body.escalation.state, "resolved");

    const gate = await human.get(`/api/releases/${rel.body.id}/gate`).expect(200);
    assert.equal(gate.body.mode, "strict");
  });

  it("acknowledges escalation with override in one step", async () => {
    const email = `escov_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "EscOv" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await setUserRole(me.body.user.id, ws, "vp_engineering");
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);

    const rel = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "esc-override-v1", release_type: "model_update" })
      .expect(201);

    const keyRes = await human.post(`/api/workspaces/${ws}/api-keys`).send({ name: "esc-ov-agent" }).expect(201);
    const agent = request(app);
    const esc = await agent
      .post(`/api/releases/${rel.body.id}/escalate`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({ reason: "Accuracy blocked after reruns", blocking_signals: ["accuracy"] })
      .expect(202);

    const out = await human
      .post(`/api/workspaces/${ws}/escalations/${esc.body.escalation.id}/acknowledge-and-override`)
      .send({
        note: "Ship with monitoring",
        justification: "Accepting accuracy regression for hotfix; rollback plan in place for 24h.",
        metadata: {
          impact_summary: "Limited cohort on new routing path",
          mitigation_plan: "Rollback via feature flag; on-call monitoring",
          follow_up_due_date: "2026-12-31"
        }
      })
      .expect(200);

    assert.equal(out.body.escalation.state, "resolved");
    assert.equal(out.body.override.status, "CERTIFIED_WITH_OVERRIDE");

    const release = await queryOne("SELECT status FROM releases WHERE id = $1", [rel.body.id]);
    assert.equal(release.status, "CERTIFIED_WITH_OVERRIDE");

    const audit = await queryOne(
      "SELECT event_type FROM audit_events WHERE release_id = $1 AND event_type = $2 ORDER BY id DESC LIMIT 1",
      [rel.body.id, "ESCALATION_ACKNOWLEDGED_WITH_OVERRIDE"]
    );
    assert.ok(audit);
  });

  it("gate uses workspace default mode when query param omitted", async () => {
    const email = `gatepol_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "GatePol" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await human.post(`/api/workspaces/${ws}/policies`).send({ gate_mode: "strict" }).expect(200);
    const rel = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "gate-pol-v1", release_type: "model_update" })
      .expect(201);

    const gate = await human.get(`/api/releases/${rel.body.id}/gate`).expect(200);
    assert.equal(gate.body.mode, "strict");
  });
});

