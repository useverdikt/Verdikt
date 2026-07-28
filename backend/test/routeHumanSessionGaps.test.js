"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";

const crypto = require("crypto");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { initDatabase } = require("../src/database");
const { createApp } = require("../src/app");

let app;

before(async () => {
  await initDatabase();
  app = await createApp();
});

async function createHumanSession() {
  const email = `human_${crypto.randomBytes(4).toString("hex")}@test.local`;
  const human = request.agent(app);
  await human.post("/api/auth/register").send({ email, password: "password123", name: "Human" }).expect(200);
  await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
  const me = await human.get("/api/auth/me").expect(200);
  return { human, email, workspaceId: me.body.user.workspace_id };
}

async function createAgentKey(human, workspaceId) {
  const keyRes = await human
    .post(`/api/workspaces/${workspaceId}/api-keys`)
    .send({ name: "test-agent" })
    .expect(201);
  return keyRes.body.api_key;
}

async function createRelease(human, workspaceId) {
  const rel = await human
    .post(`/api/workspaces/${workspaceId}/releases`)
    .send({ version: "v1", release_type: "model_update" })
    .expect(201);
  return rel.body.id;
}

async function agentRequest(workspaceId, releaseId, apiKey) {
  return request(app)
    .post(`/api/releases/${releaseId}/production-signals/align`)
    .set("Authorization", `Bearer ${apiKey}`);
}

describe("release governance routes require human session", () => {
  it("POST /production-signals/align rejects agent API key with 403", async () => {
    const { human, workspaceId } = await createHumanSession();
    const apiKey = await createAgentKey(human, workspaceId);
    const releaseId = await createRelease(human, workspaceId);

    const res = await request(app)
      .post(`/api/releases/${releaseId}/production-signals/align`)
      .set("Authorization", `Bearer ${apiKey}`);

    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, "human_session_required");
    assert.match(res.body.message || "", /human session/i);
    assert.ok(res.body.request_id);
  });

  it("PUT /production-signals/incident rejects agent API key with 403", async () => {
    const { human, workspaceId } = await createHumanSession();
    const apiKey = await createAgentKey(human, workspaceId);
    const releaseId = await createRelease(human, workspaceId);

    const res = await request(app)
      .put(`/api/releases/${releaseId}/production-signals/incident`)
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ incident_ref: "INC-123" });

    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, "human_session_required");
    assert.match(res.body.message || "", /human session/i);
    assert.ok(res.body.request_id);
  });

  it("POST /collection-deadline/extend rejects agent API key with 403", async () => {
    const { human, workspaceId } = await createHumanSession();
    const apiKey = await createAgentKey(human, workspaceId);
    const releaseId = await createRelease(human, workspaceId);

    const res = await request(app)
      .post(`/api/releases/${releaseId}/collection-deadline/extend`)
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ extend_minutes: 10 });

    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, "human_session_required");
    assert.match(res.body.message || "", /human session/i);
    assert.ok(res.body.request_id);
  });

  it("POST /intelligence/decision rejects agent API key with 403", async () => {
    const { human, workspaceId } = await createHumanSession();
    const apiKey = await createAgentKey(human, workspaceId);
    const releaseId = await createRelease(human, workspaceId);

    const res = await request(app)
      .post(`/api/releases/${releaseId}/intelligence/decision`)
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ decision: "applied", notes: "Looks good" });

    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, "human_session_required");
    assert.match(res.body.message || "", /human session/i);
    assert.ok(res.body.request_id);
  });

  it("POST /intelligence/decision ignores body actor and records the authenticated human", async () => {
    const { human, email, workspaceId } = await createHumanSession();
    const releaseId = await createRelease(human, workspaceId);

    const res = await human
      .post(`/api/releases/${releaseId}/intelligence/decision`)
      .send({ decision: "applied", notes: "Ship it", actor: "attacker@example.com" });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.decision.actor, email, "decision actor should be the authenticated human, not the body");
  });
});
