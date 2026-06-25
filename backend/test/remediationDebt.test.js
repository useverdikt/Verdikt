"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.NODE_ENV = "test";

const crypto = require("crypto");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { initDatabase, queryOne, run } = require("../src/database");
const { createApp } = require("../src/app");
const { getWorkspaceRemediationDebt } = require("../src/services/remediationDebt");
const { nowIso } = require("../src/lib/time");

let app;

before(async () => {
  await initDatabase();
  app = createApp();
});

describe("remediationDebt", () => {
  it("returns active false after a clean CERTIFIED prod release clears bypass debt", async () => {
    const email = `debtclear_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Debt Clear" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const bypassAt = nowIso();
    const bypass = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Bypass (#9501)", release_type: "model_update", pr_number: 9501 })
      .expect(201);
    await run(
      "UPDATE releases SET status = ?, environment = ?, shipped_without_certification = 1, shipped_without_certification_at = ?, updated_at = ? WHERE id = ?",
      ["UNCERTIFIED", "prod", bypassAt, bypassAt, bypass.body.id]
    );

    let debt = await getWorkspaceRemediationDebt(ws);
    assert.equal(debt.active, true);

    const recoveryAt = nowIso();
    const recovery = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Recovery CERTIFIED (#9502)", release_type: "model_update", pr_number: 9502 })
      .expect(201);
    await run(
      "UPDATE releases SET status = ?, environment = ?, shipped_without_certification = 0, verdict_issued_at = ?, updated_at = ? WHERE id = ?",
      ["CERTIFIED", "prod", recoveryAt, recoveryAt, recovery.body.id]
    );

    debt = await getWorkspaceRemediationDebt(ws);
    assert.equal(debt.active, false);
    assert.equal(debt.cleared, true);
    assert.equal(debt.cleared_by_release_id, recovery.body.id);
  });

  it("rejects incident_hotfix without corroborated incident context", async () => {
    const email = `noinc_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "No Inc" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const res = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Hotfix (#9503)", release_type: "incident_hotfix", pr_number: 9503 })
      .expect(400);
    assert.match(res.body.error, /incident context/i);
    assert.equal(res.body.incident_context?.eligible, false);
  });
});
