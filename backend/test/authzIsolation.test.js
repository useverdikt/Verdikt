"use strict";

/**
 * Cross-workspace isolation and human control-plane authz over HTTP.
 * Asserts status codes *and* that foreign / denied writes leave DB rows unchanged.
 */

require("./helpers/backendFixtures");

const crypto = require("crypto");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../src/app");
const { queryOne } = require("../src/database");
const { ensureWorkspaceSeeded } = require("../src/services/domain");
const { seedDefaultThresholdsForTest, setUserRole } = require("./helpers/backendFixtures");

let app;

before(async () => {
  app = await createApp();
});

async function registerSession(prefix) {
  const email = `${prefix}_${crypto.randomBytes(4).toString("hex")}@test.local`;
  const human = request.agent(app);
  await human.post("/api/auth/register").send({ email, password: "password123", name: prefix }).expect(200);
  await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
  const me = await human.get("/api/auth/me").expect(200);
  return { human, email, userId: me.body.user.id, workspaceId: me.body.user.workspace_id };
}

async function createApiKey(human, workspaceId, name = "iso-key") {
  const res = await human.post(`/api/workspaces/${workspaceId}/api-keys`).send({ name }).expect(201);
  return { keyId: res.body.id, apiKey: res.body.api_key };
}

async function createRelease(human, workspaceId, version) {
  const res = await human
    .post(`/api/workspaces/${workspaceId}/releases`)
    .send({ version, release_type: "model_update", environment: "pre-prod" })
    .expect(201);
  return res.body.id;
}

async function certifyRelease(human, releaseId, workspaceId) {
  await ensureWorkspaceSeeded(workspaceId);
  await seedDefaultThresholdsForTest(workspaceId);
  await human
    .post(`/api/releases/${releaseId}/signals`)
    .send({
      source: "iso",
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
  const row = await queryOne("SELECT status FROM releases WHERE id = $1", [releaseId]);
  assert.equal(row.status, "CERTIFIED");
}

describe("cross-workspace isolation", () => {
  it("blocks workspace A session from mutating workspace B resources", async () => {
    const a = await registerSession("iso_a");
    const b = await registerSession("iso_b");
    await ensureWorkspaceSeeded(b.workspaceId);
    await seedDefaultThresholdsForTest(b.workspaceId);

    const releaseB = await createRelease(b.human, b.workspaceId, `iso-b-${crypto.randomBytes(3).toString("hex")}`);
    const signalsBefore = await queryOne("SELECT COUNT(*)::int AS c FROM signals WHERE release_id = $1", [
      releaseB
    ]);
    const threshBefore = await queryOne(
      "SELECT min_value FROM thresholds WHERE workspace_id = $1 AND signal_id = 'accuracy'",
      [b.workspaceId]
    );

    const ingest = await a.human
      .post(`/api/releases/${releaseB}/signals`)
      .send({ source: "attacker", signals: { accuracy: 1 } });
    assert.equal(ingest.status, 403);
    assert.match(String(ingest.body.error || ""), /access|workspace|release/i);

    const gate = await a.human.get(`/api/releases/${releaseB}/gate`);
    assert.equal(gate.status, 403);

    const override = await a.human
      .post(`/api/releases/${releaseB}/override`)
      .send({
        justification: "Cross-tenant override attempt that must never land."
      });
    assert.equal(override.status, 403);

    const thresh = await a.human
      .post(`/api/workspaces/${b.workspaceId}/thresholds`)
      .send({ thresholds: { accuracy: { min: 1, max: null, required_for_certification: true } } });
    assert.equal(thresh.status, 403);

    const signalsAfter = await queryOne("SELECT COUNT(*)::int AS c FROM signals WHERE release_id = $1", [
      releaseB
    ]);
    assert.equal(signalsAfter.c, signalsBefore.c);

    const overrides = await queryOne("SELECT COUNT(*)::int AS c FROM overrides WHERE release_id = $1", [
      releaseB
    ]);
    assert.equal(overrides.c, 0);

    const threshAfter = await queryOne(
      "SELECT min_value FROM thresholds WHERE workspace_id = $1 AND signal_id = 'accuracy'",
      [b.workspaceId]
    );
    assert.equal(Number(threshAfter.min_value), Number(threshBefore.min_value));
  });

  it("blocks workspace A API key from creating releases in workspace B", async () => {
    const a = await registerSession("iso_key_a");
    const b = await registerSession("iso_key_b");
    const { apiKey } = await createApiKey(a.human, a.workspaceId, "foreign");

    const before = await queryOne("SELECT COUNT(*)::int AS c FROM releases WHERE workspace_id = $1", [
      b.workspaceId
    ]);
    const res = await request(app)
      .post(`/api/workspaces/${b.workspaceId}/releases`)
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ version: "stolen-v1", release_type: "model_update" });
    assert.equal(res.status, 403);
    assert.match(String(res.body.error || ""), /workspace|access/i);

    const after = await queryOne("SELECT COUNT(*)::int AS c FROM releases WHERE workspace_id = $1", [
      b.workspaceId
    ]);
    assert.equal(after.c, before.c);
  });
});

describe("revoke certification HTTP", () => {
  it("requires human session and override-approver role; VP revoke flips gate to revoked", async () => {
    const s = await registerSession("rev");
    await setUserRole(s.userId, s.workspaceId, "vp_engineering");
    await s.human.post("/api/auth/login").send({ email: s.email, password: "password123" }).expect(200);

    const releaseId = await createRelease(s.human, s.workspaceId, `rev-${crypto.randomBytes(3).toString("hex")}`);
    await certifyRelease(s.human, releaseId, s.workspaceId);

    const { apiKey } = await createApiKey(s.human, s.workspaceId, "rev-agent");
    const agentAttempt = await request(app)
      .post(`/api/releases/${releaseId}/revoke-certification`)
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ justification: "Agent must not revoke certifications over the API." });
    assert.equal(agentAttempt.status, 403);
    assert.equal(agentAttempt.body.error, "human_session_required");

    await setUserRole(s.userId, s.workspaceId, "engineer");
    await s.human.post("/api/auth/login").send({ email: s.email, password: "password123" }).expect(200);
    const engAttempt = await s.human
      .post(`/api/releases/${releaseId}/revoke-certification`)
      .send({ justification: "Engineer must not revoke without approver role privileges." });
    assert.equal(engAttempt.status, 403);
    assert.match(String(engAttempt.body.error || ""), /override_approver|approver/i);

    const stillCertified = await queryOne("SELECT status FROM releases WHERE id = $1", [releaseId]);
    assert.equal(stillCertified.status, "CERTIFIED");

    await setUserRole(s.userId, s.workspaceId, "vp_engineering");
    await s.human.post("/api/auth/login").send({ email: s.email, password: "password123" }).expect(200);
    const revoked = await s.human
      .post(`/api/releases/${releaseId}/revoke-certification`)
      .send({ justification: "Incident response: certification revoked after production regression." })
      .expect(200);
    assert.equal(revoked.body.status, "CERTIFICATION_REVOKED");

    const gate = await s.human.get(`/api/releases/${releaseId}/gate`).expect(200);
    assert.equal(gate.body.action, "revoked");

    const audit = await queryOne(
      `SELECT event_type, actor_type, actor_name FROM audit_events
       WHERE release_id = $1 AND event_type = 'CERTIFICATION_REVOKED'
       ORDER BY id DESC LIMIT 1`,
      [releaseId]
    );
    assert.ok(audit, "expected a CERTIFICATION_REVOKED audit row");
    assert.equal(audit.actor_type, "USER");
    // Actor is the session user's name (register prefix) or email — not SYSTEM/AGENT.
    assert.ok(
      audit.actor_name === "rev" || audit.actor_name === s.email || String(audit.actor_name || "").includes("rev"),
      `unexpected actor_name ${audit.actor_name}`
    );
  });
});

describe("override denial paths", () => {
  it("rejects agent key and engineer; leaves overrides table empty", async () => {
    const s = await registerSession("ovden");
    const releaseId = await createRelease(s.human, s.workspaceId, `ovden-${crypto.randomBytes(3).toString("hex")}`);
    const { apiKey } = await createApiKey(s.human, s.workspaceId, "ov-agent");

    const agentAttempt = await request(app)
      .post(`/api/releases/${releaseId}/override`)
      .set("Authorization", `Bearer ${apiKey}`)
      .send({ justification: "Agent override must be rejected by human session guard." });
    assert.equal(agentAttempt.status, 403);
    assert.equal(agentAttempt.body.error, "human_session_required");

    await setUserRole(s.userId, s.workspaceId, "engineer");
    await s.human.post("/api/auth/login").send({ email: s.email, password: "password123" }).expect(200);
    const engAttempt = await s.human
      .post(`/api/releases/${releaseId}/override`)
      .send({ justification: "Engineer override must be rejected by approver role guard." });
    assert.equal(engAttempt.status, 403);

    const count = await queryOne("SELECT COUNT(*)::int AS c FROM overrides WHERE release_id = $1", [releaseId]);
    assert.equal(count.c, 0);
    const status = await queryOne("SELECT status FROM releases WHERE id = $1", [releaseId]);
    assert.equal(status.status, "COLLECTING");
  });
});

describe("API key revocation", () => {
  it("revoked key cannot gate; foreign workspace cannot revoke the key", async () => {
    const a = await registerSession("keyrev_a");
    const b = await registerSession("keyrev_b");
    const releaseId = await createRelease(a.human, a.workspaceId, `keyrev-${crypto.randomBytes(3).toString("hex")}`);
    await certifyRelease(a.human, releaseId, a.workspaceId);

    const { keyId, apiKey } = await createApiKey(a.human, a.workspaceId, "live-then-dead");
    await request(app)
      .get(`/api/releases/${releaseId}/gate`)
      .set("Authorization", `Bearer ${apiKey}`)
      .expect(200);

    const foreign = await b.human.delete(`/api/workspaces/${a.workspaceId}/api-keys/${keyId}`);
    assert.equal(foreign.status, 403);
    await request(app)
      .get(`/api/releases/${releaseId}/gate`)
      .set("Authorization", `Bearer ${apiKey}`)
      .expect(200);

    await a.human.delete(`/api/workspaces/${a.workspaceId}/api-keys/${keyId}`).expect(200);
    const dead = await request(app)
      .get(`/api/releases/${releaseId}/gate`)
      .set("Authorization", `Bearer ${apiKey}`);
    assert.equal(dead.status, 401);
    assert.match(String(dead.body.error || ""), /invalid_api_key|unauthorized|api_key/i);

    const row = await queryOne("SELECT revoked_at FROM workspace_api_keys WHERE id = $1", [keyId]);
    assert.ok(row.revoked_at);
  });
});

describe("locked release ingest over HTTP", () => {
  it("rejects a new idempotency key on a CERTIFIED release and keeps signal count", async () => {
    const s = await registerSession("lockingest");
    const releaseId = await createRelease(
      s.human,
      s.workspaceId,
      `lock-${crypto.randomBytes(3).toString("hex")}`
    );
    await certifyRelease(s.human, releaseId, s.workspaceId);
    const before = await queryOne("SELECT COUNT(*)::int AS c FROM signals WHERE release_id = $1", [releaseId]);

    const blocked = await s.human
      .post(`/api/releases/${releaseId}/signals`)
      .set("Idempotency-Key", `new-${crypto.randomBytes(6).toString("hex")}`)
      .send({ source: "late", signals: { accuracy: 1 } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.details?.status, "CERTIFIED");
    assert.match(
      String(blocked.body.message || blocked.body.error || ""),
      /locked|certification|verdict/i
    );

    const after = await queryOne("SELECT COUNT(*)::int AS c FROM signals WHERE release_id = $1", [releaseId]);
    assert.equal(after.c, before.c);
  });
});
