"use strict";

/**
 * Post-verdict side effects: outbox rows written when a release certifies.
 * Slack colour/string unit checks were removed — they locked copy and hex values
 * without exercising the delivery path.
 */

require("./helpers/backendFixtures");

const crypto = require("crypto");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { queryAll } = require("../src/database");
const {
  ensureWorkspaceSeeded,
  createApp,
  seedDefaultThresholdsForTest
} = require("./helpers/backendFixtures");

describe("postVerdictEffects side-effects", () => {
  const app = createApp();

  it("UNCERTIFIED ingest yields a blocked gate with remediation, not certification", async () => {
    const email = `pvefx_unc_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "PVE Unc" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: `pve-unc-v1-${crypto.randomBytes(3).toString("hex")}`, release_type: "model_update" })
      .expect(201);

    const ingest = await agent
      .post(`/api/releases/${created.body.id}/signals`)
      .send({
        source: "test",
        signals: {
          accuracy: 50,
          safety: 50,
          tone: 50,
          hallucination: 50,
          relevance: 50,
          smoke: 0,
          e2e_regression: 0,
          manual_qa_pct: 50
        }
      })
      .expect(200);

    assert.equal(ingest.body.status, "UNCERTIFIED");
    const gate = await agent.get(`/api/releases/${created.body.id}/gate`).expect(200);
    assert.ok(["escalate", "self_heal"].includes(gate.body.action));
    assert.ok(gate.body.remediation, "remediation should be present on UNCERTIFIED gate");
    assert.equal(gate.body.certification, null);
    assert.equal(gate.body.can_merge, false);
  });

  it("CERTIFIED ingest enqueues outbound_effect_outbox rows for the release", async () => {
    const email = `pvefx_cert_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "PVE Cert" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({
        version: `pve-cert-v1-${crypto.randomBytes(3).toString("hex")}`,
        release_type: "model_update",
        environment: "pre-prod"
      })
      .expect(201);

    const ingest = await agent
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
    assert.equal(ingest.body.status, "CERTIFIED");

    const outbox = await queryAll(
      `SELECT effect_type, state FROM outbound_effect_outbox WHERE release_id = $1 ORDER BY effect_type`,
      [created.body.id]
    );
    assert.deepEqual(
      outbox.map((r) => r.effect_type),
      ["outbound_webhook", "release_callback", "slack_verdict", "vcs_writeback"]
    );

    const gate = await agent.get(`/api/releases/${created.body.id}/gate`).expect(200);
    assert.equal(gate.body.action, "merge");
  });
});
