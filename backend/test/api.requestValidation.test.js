"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";

const crypto = require("crypto");
const { before, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { initDatabase, run } = require("../src/database");
const { createApp } = require("../src/app");

let app;
let human;
let workspaceId;
let releaseId;
let apiKey;

before(async () => {
  await initDatabase();
  app = createApp();

  const email = `schema_${crypto.randomBytes(5).toString("hex")}@test.local`;
  human = request.agent(app);
  await human
    .post("/api/auth/register")
    .send({ email, password: "password123", name: "Schema Admin" })
    .expect(200);
  await run("UPDATE users SET role = 'CTO' WHERE email = $1", [email]);
  await human
    .post("/api/auth/login")
    .send({ email, password: "password123" })
    .expect(200);

  const me = await human.get("/api/auth/me").expect(200);
  workspaceId = me.body.user.workspace_id;

  const release = await human
    .post(`/api/workspaces/${workspaceId}/releases`)
    .send({ version: "schema-validation", release_type: "model_update" })
    .expect(201);
  releaseId = release.body.id;

  const key = await human
    .post(`/api/workspaces/${workspaceId}/api-keys`)
    .send({ name: "schema-test-agent" })
    .expect(201);
  apiKey = key.body.api_key;
});

describe("governance request schemas", () => {
  it("rejects signal arrays with field-level details", async () => {
    const response = await human
      .post(`/api/releases/${releaseId}/signals`)
      .send({ source: "manual", signals: [91, 92] })
      .expect(400);

    assert.equal(response.body.error, "bad_request");
    assert.equal(response.body.message, "signals object is required");
    assert.ok(
      response.body.details.issues.some((issue) => issue.path === "signals")
    );
  });

  it("rejects malformed threshold rules before persistence", async () => {
    const response = await human
      .post(`/api/workspaces/${workspaceId}/thresholds`)
      .send({
        thresholds: {
          accuracy: {
            min: "ninety",
            required_for_certification: "yes"
          }
        }
      })
      .expect(400);

    assert.equal(response.body.error, "bad_request");
    assert.ok(
      response.body.details.issues.some(
        (issue) => issue.path === "thresholds.accuracy.min"
      )
    );
  });

  it("rejects invalid policy enums instead of silently ignoring them", async () => {
    const response = await human
      .post(`/api/workspaces/${workspaceId}/policies`)
      .send({ gate_mode: "sometimes" })
      .expect(400);

    assert.equal(response.body.message, "invalid policy request body");
    assert.ok(
      response.body.details.issues.some((issue) => issue.path === "gate_mode")
    );
  });

  it("runs authorization before policy body validation", async () => {
    const response = await request(app)
      .post(`/api/workspaces/${workspaceId}/policies`)
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ gate_mode: "sometimes" })
      .expect(403);

    assert.equal(response.body.error, "human_session_required");
  });

  it("rejects override actor-type spoofing", async () => {
    const response = await human
      .post(`/api/releases/${releaseId}/override`)
      .send({
        approver_type: "SYSTEM",
        justification: "A human approved this controlled release.",
        metadata: {
          impact_summary: "Limited internal cohort.",
          mitigation_plan: "Rollback immediately if monitoring degrades.",
          follow_up_due_date: "2026-08-20"
        }
      })
      .expect(400);

    assert.equal(response.body.message, "invalid override request body");
    assert.ok(
      response.body.details.issues.some(
        (issue) => issue.path === "approver_type"
      )
    );
  });
});
