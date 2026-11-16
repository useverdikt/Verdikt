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

describe("Agentic layer", () => {
  const app = createApp();

  it("API key auth: create release, post signals, check gate", async () => {
    const email = `agentic_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Human" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const keyRes = await human
      .post(`/api/workspaces/${ws}/api-keys`)
      .send({ name: "ci-agent" })
      .expect(201);
    assert.ok(String(keyRes.body.api_key).startsWith("vdk_live_"));

    const agent = request(app);
    const rel = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({ version: "agent-v1", release_type: "model_update" })
      .expect(201);
    assert.equal(rel.body.trigger_source, "agent");

    const keyCreateDenied = await agent
      .post(`/api/workspaces/${ws}/api-keys`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({ name: "blocked" });
    assert.equal(keyCreateDenied.status, 403);
    assert.equal(keyCreateDenied.body.error, "human_session_required");

    await ensureWorkspaceSeeded(ws);
    const thresholdMap = await getThresholdMap(ws);
    const signals = {};
    for (const sid of ["accuracy", "safety", "tone", "hallucination", "relevance"]) {
      const t = thresholdMap[sid];
      signals[sid] = t?.min != null ? Number(t.min) + 1 : 90;
    }
    signals.smoke = 100;
    signals.e2e_regression = 100;
    signals.manual_qa_pct = 100;

    const ingest = await agent
      .post(`/api/releases/${rel.body.id}/signals`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({ source: "agent", signals })
      .expect(200);
    // Passing every required floor by min+1 must certify — do not accept any status.
    assert.equal(ingest.body.status, "CERTIFIED");

    const gate = await agent
      .get(`/api/releases/${rel.body.id}/gate`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .expect(200);
    assert.equal(gate.body.action, "merge");
    assert.equal(gate.body.can_merge, true);
    assert.equal(gate.body.gate.exit_code, 0);
  });
});

