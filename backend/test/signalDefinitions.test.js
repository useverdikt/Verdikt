"use strict";

const crypto = require("crypto");

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.GITHUB_WEBHOOK_SECRET = "test-github-webhook-secret-32-min";
process.env.NODE_ENV = "test";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { initDatabase } = require("../src/database");
const { createApp } = require("../src/app");

before(async () => {
  await initDatabase();
});

describe("Workspace signal definitions", () => {
  const app = createApp();

  it("lists catalog, adopts library signal, creates custom signal, deletes", async () => {
    const email = `sigdef_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "SigDef" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const catalog = await agent.get(`/api/workspaces/${ws}/signal-definitions`).expect(200);
    assert.ok(Array.isArray(catalog.body.definitions));
    assert.ok(catalog.body.definitions.length >= 5);
    assert.ok(Array.isArray(catalog.body.library));
    assert.ok(Array.isArray(catalog.body.connectors));
    assert.ok(catalog.body.connectors.some((c) => c.source_id === "zizkadb"));

    const adopt = await agent
      .post(`/api/workspaces/${ws}/signal-definitions/adopt`)
      .send({ signal_id: "smoke", required_for_certification: false })
      .expect(200);
    assert.ok(adopt.body.definitions.some((d) => d.signal_id === "smoke"));

    const custom = await agent
      .post(`/api/workspaces/${ws}/signal-definitions`)
      .send({
        signal_id: "behavioural_drift",
        display_name: "Behavioural Drift",
        direction: "max",
        unit: "score",
        source_id: "zizkadb",
        threshold: { max: 0.15 },
        required_for_certification: true
      })
      .expect(201);
    assert.equal(custom.body.definition.signal_id, "behavioural_drift");
    assert.equal(custom.body.thresholds.behavioural_drift.max, 0.15);
    assert.equal(custom.body.thresholds.behavioural_drift.required_for_certification, true);

    await agent.delete(`/api/workspaces/${ws}/signal-definitions/smoke`).expect(200);
    const afterDelete = await agent.get(`/api/workspaces/${ws}/signal-definitions`).expect(200);
    assert.ok(!afterDelete.body.definitions.some((d) => d.signal_id === "smoke"));
    assert.ok(!afterDelete.body.thresholds.smoke);
  });
});
