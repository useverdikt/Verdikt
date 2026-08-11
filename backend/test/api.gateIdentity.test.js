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
  ensureWorkspaceSeeded,
  GEMINI_STUB,
  createApp,
  writeAudit,
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

describe("Release identity + SHA correlation", () => {
  const app = createApp();

  async function signVerdiktWebhook(workspaceId, body) {
    const { getPlaintextInboundSecret } = require("../src/services/inboundWebhookSecrets");
    const secret = (await getPlaintextInboundSecret(workspaceId)) || process.env.WEBHOOK_SECRET;
    const raw = JSON.stringify(body);
    const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    return { raw, signature: `sha256=${sig}` };
  }

  it("resolves ingest by commit_sha and dedupes agent release opens on same SHA", async () => {
    const email = `sha_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "SHA" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const keyRes = await human
      .post(`/api/workspaces/${ws}/api-keys`)
      .send({ name: "sha-agent" })
      .expect(201);

    const sha = crypto.randomBytes(20).toString("hex");
    const prNumber = 88000 + crypto.randomInt(999);
    const agent = request(app);

    const first = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({
        version: "sha-correlation-v1",
        release_type: "model_update",
        commit_sha: sha,
        pr_number: prNumber,
        github_owner: "useverdikt",
        github_repo: "demo-repo"
      })
      .expect(201);
    assert.equal(first.body.reused, false);

    const second = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({
        version: "sha-correlation-v1",
        release_type: "model_update",
        commit_sha: sha,
        pr_number: prNumber,
        github_owner: "useverdikt",
        github_repo: "demo-repo"
      })
      .expect(200);
    assert.equal(second.body.reused, true);
    assert.equal(second.body.id, first.body.id);

    const count = await queryOne(
      "SELECT COUNT(*) AS c FROM releases WHERE workspace_id = $1 AND commit_sha = $2 AND pr_number = $3",
      [ws, sha, prNumber]
    );
    assert.equal(Number(count?.c || 0), 1);

    const { resolveReleaseForWorkspaceIngest } = require("../src/services/releaseIdentity");
    const resolved = await resolveReleaseForWorkspaceIngest(ws, {
      commit_sha: sha,
      pr_number: prNumber,
      github_owner: "useverdikt",
      github_repo: "demo-repo"
    });
    assert.equal(resolved.id, first.body.id);
  });

  it("CI webhook attaches signals to release matched by commit_sha", async () => {
    const email = `ci_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "CI" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const sha = crypto.randomBytes(20).toString("hex");
    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({
        version: "ci-target-v1",
        release_type: "model_update",
        commit_sha: sha,
        pr_number: 99001,
        github_owner: "acme",
        github_repo: "app"
      })
      .expect(201);

    const body = {
      commit_sha: sha,
      pr_number: 99001,
      repo_owner: "acme",
      repo_name: "app",
      idempotency_key: `ci-replay-${created.body.id}`,
      signals: { accuracy: 92, safety: 91, tone: 88, hallucination: 95, relevance: 90 }
    };
    const signed = await signVerdiktWebhook(ws, body);

    const ingest = await request(app)
      .post(`/api/workspaces/${ws}/integrations/ci`)
      .set("Content-Type", "application/json")
      .set("x-verdikt-signature", signed.signature)
      .send(signed.raw)
      .expect(200);

    assert.equal(ingest.body.release_id, created.body.id);
    const sigCount = await queryOne("SELECT COUNT(*) AS c FROM signals WHERE release_id = $1", [created.body.id]);
    assert.ok(Number(sigCount?.c || 0) >= 5);

    const auditBefore = await queryOne(
      "SELECT COUNT(*) AS c FROM audit_events WHERE release_id = $1",
      [created.body.id]
    );
    await run("UPDATE releases SET status = 'CERTIFIED' WHERE id = $1", [created.body.id]);
    const replay = await request(app)
      .post(`/api/workspaces/${ws}/integrations/ci`)
      .set("Content-Type", "application/json")
      .set("x-verdikt-signature", signed.signature)
      .send(signed.raw)
      .expect(200);
    assert.equal(replay.body.duplicate, true);
    assert.equal(replay.body.inserted_count, 0);
    assert.equal(replay.body.release_id, created.body.id);
    const auditAfter = await queryOne(
      "SELECT COUNT(*) AS c FROM audit_events WHERE release_id = $1",
      [created.body.id]
    );
    assert.equal(Number(auditAfter.c), Number(auditBefore.c));
  });

  it("eval webhook duplicate replay succeeds after the release becomes locked", async () => {
    const email = `eval_replay_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human
      .post("/api/auth/register")
      .send({ email, password: "password123", name: "Eval Replay" })
      .expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "eval-replay-v1", release_type: "model_update" })
      .expect(201);
    const body = {
      release_id: created.body.id,
      provider: "generic",
      payload: { accuracy: 92 },
      idempotency_key: `eval-replay-${created.body.id}`
    };
    const signed = await signVerdiktWebhook(ws, body);

    await request(app)
      .post(`/api/workspaces/${ws}/integrations/evals`)
      .set("Content-Type", "application/json")
      .set("x-verdikt-signature", signed.signature)
      .send(signed.raw)
      .expect(200);
    await run("UPDATE releases SET status = 'CERTIFIED' WHERE id = $1", [created.body.id]);

    const replay = await request(app)
      .post(`/api/workspaces/${ws}/integrations/evals`)
      .set("Content-Type", "application/json")
      .set("x-verdikt-signature", signed.signature)
      .send(signed.raw)
      .expect(200);
    assert.equal(replay.body.duplicate, true);
    assert.equal(replay.body.inserted_count, 0);
    assert.equal(replay.body.integration.ingest_mode, "workspace_webhook");
  });

  it("gate response includes action field for agent loop", async () => {
    const email = `gate_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Gate" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "gate-action-v1", release_type: "model_update" })
      .expect(201);

    const gate = await human.get(`/api/releases/${created.body.id}/gate`).expect(200);
    assert.ok(["merge", "collecting", "self_heal", "escalate"].includes(gate.body.action));
    assert.equal(gate.body.action, "collecting");
    assert.ok(Array.isArray(gate.body.blockers));
    assert.ok(gate.body.blockers.length >= 1);
    assert.equal(typeof gate.body.next_step, "string");
    assert.ok(gate.body.next_step.length > 0);
  });

  it("gate includes remediation intelligence when blocked (UNCERTIFIED)", async () => {
    const email = `gate_remed_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Gate Remed" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);

    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "gate-remed-v1", release_type: "model_update" })
      .expect(201);

    const ingest = await human
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
    assert.equal(ingest.body.status, "UNCERTIFIED");

    const gate = await human.get(`/api/releases/${created.body.id}/gate`).expect(200);
    assert.equal(gate.body.action, "escalate");
    assert.ok(gate.body.remediation);
    assert.ok(typeof gate.body.remediation.summary === "string" && gate.body.remediation.summary.length > 0);
    assert.ok(Array.isArray(gate.body.remediation.failures));
    assert.ok(gate.body.remediation.failures.some((f) => f.signal_id === "accuracy"));
    assert.ok(Array.isArray(gate.body.remediation.suggested_actions));
    assert.ok(gate.body.blocking_signals.includes("accuracy"));
  });

  it("gate includes certification intelligence when certified (CERTIFIED)", async () => {
    const email = `gate_cert_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Gate Cert" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);

    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "gate-cert-v1", release_type: "model_update" })
      .expect(201);

    const ingest = await human
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

    const gate = await human.get(`/api/releases/${created.body.id}/gate`).expect(200);
    assert.equal(gate.body.action, "merge");
    assert.ok(gate.body.certification, "certification context should be present on CERTIFIED gate");
    assert.ok(typeof gate.body.certification.summary === "string" && gate.body.certification.summary.length > 0);
    assert.ok(Array.isArray(gate.body.certification.passed_signals), "passed_signals should be an array");
    assert.ok(typeof gate.body.certification.confidence === "number", "confidence should be a number");
    assert.ok(typeof gate.body.certification.risk_level === "string", "risk_level should be a string");
    assert.strictEqual(gate.body.remediation, null, "remediation should be null on a CERTIFIED gate");
  });

  it("gate by commit_sha resolves release without release_id (CI path)", async () => {
    const email = `gate_sha_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Gate SHA" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const keyRes = await human.post(`/api/workspaces/${ws}/api-keys`).send({ name: "gha-gate" }).expect(201);
    const sha = crypto.randomBytes(20).toString("hex");
    const agent = request(app);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({
        version: "gha-gate-v1",
        release_type: "model_update",
        commit_sha: sha,
        pr_number: 42,
        github_owner: "acme",
        github_repo: "app"
      })
      .expect(201);

    const gate = await agent
      .get(`/api/workspaces/${ws}/gate`)
      .query({ commit_sha: sha, github_owner: "acme", github_repo: "app", pr_number: 42 })
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .expect(200);

    assert.equal(gate.body.release_id, created.body.id);
    assert.equal(gate.body.commit_sha, sha);
    assert.equal(gate.body.action, "collecting");
    assert.equal(gate.body.gate.exit_code, 1);

    const newerSha = crypto.randomBytes(20).toString("hex");
    const staleGate = await agent
      .get(`/api/workspaces/${ws}/gate`)
      .query({
        commit_sha: newerSha,
        github_owner: "acme",
        github_repo: "app",
        pr_number: 42
      })
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .expect(404);
    assert.equal(staleGate.body.details.commit_sha, newerSha);

    await agent
      .get(`/api/workspaces/${ws}/gate`)
      .query({ commit_sha: "deadbeef" })
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .expect(404);
  });

  it("agent session header correlates audit events for chain of evidence", async () => {
    const email = `agent_sess_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Agent Sess" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const keyRes = await human.post(`/api/workspaces/${ws}/api-keys`).send({ name: "session-test" }).expect(201);
    const sessionId = `as_${crypto.randomBytes(16).toString("hex")}`;
    const agent = request(app);
    const sha = crypto.randomBytes(20).toString("hex");

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .set("X-Verdikt-Agent-Session", sessionId)
      .set("X-Verdikt-Agent-Label", "cursor-cert-run")
      .send({
        version: "agent-session-v1",
        release_type: "model_update",
        commit_sha: sha,
        pr_number: 7,
        github_owner: "acme",
        github_repo: "app"
      })
      .expect(201);

    await agent
      .get(`/api/releases/${created.body.id}/gate`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .set("X-Verdikt-Agent-Session", sessionId)
      .expect(200);

    const trail = await human
      .get(`/api/workspaces/${ws}/agent-sessions/${sessionId}/audit`)
      .expect(200);

    assert.equal(trail.body.session.id, sessionId);
    assert.equal(trail.body.session.label, "cursor-cert-run");
    assert.ok(trail.body.event_count >= 2);
    const types = trail.body.events.map((e) => e.event_type);
    assert.ok(types.includes("RELEASE_CREATED") || types.some((t) => t.includes("RELEASE")));
    assert.ok(types.includes("RELEASE_GATE_CHECKED"));
    const agentEvents = trail.body.events.filter((e) => e.actor_type === "AGENT");
    assert.ok(agentEvents.length >= 1);
  });

  it("agent post_signals writes AGENT_SIGNALS_POSTED audit event", async () => {
    const email = `agent_sig_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Agent Sig" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const keyRes = await human.post(`/api/workspaces/${ws}/api-keys`).send({ name: "sig-audit" }).expect(201);
    const sessionId = `as_${crypto.randomBytes(16).toString("hex")}`;
    const agent = request(app);

    const rel = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .set("X-Verdikt-Agent-Session", sessionId)
      .send({ version: "sig-audit-v1", release_type: "model_update", commit_sha: crypto.randomBytes(20).toString("hex") })
      .expect(201);

    await agent
      .post(`/api/releases/${rel.body.id}/signals`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .set("X-Verdikt-Agent-Session", sessionId)
      .send({ source: "ci", signals: { accuracy: 88, safety: 90, relevance: 85, tone: 86, hallucination: 92 } })
      .expect(200);

    const row = await queryOne(
      "SELECT event_type, agent_session_id FROM audit_events WHERE release_id = $1 AND event_type = $2 ORDER BY id DESC LIMIT 1",
      [rel.body.id, "AGENT_SIGNALS_POSTED"]
    );
    assert.ok(row);
    assert.equal(row.agent_session_id, sessionId);
  });
});

