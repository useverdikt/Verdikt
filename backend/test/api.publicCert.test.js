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

describe("public certification records", () => {
  const app = createApp();

  it("returns live cert record with certification narrative when public slug is set", async () => {
    const slug = `pub-${crypto.randomBytes(4).toString("hex")}`;
    const email = `pubcert_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Pub Cert" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);

    await human
      .post(`/api/workspaces/${ws}/policies`)
      .send({ public_slug: slug, public_display_name: "Acme AI", public_cert_records: true })
      .expect(200);

    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "pub-cert-v1", release_type: "model_update", environment: "staging" })
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

    const pub = await request(app).get(`/api/public/cert/${slug}/pub-cert-v1`).expect(200);
    assert.equal(pub.body.workspace.slug, slug);
    assert.equal(pub.body.workspace.display_name, "Acme AI");
    assert.equal(pub.body.release.status, "CERTIFIED");
    assert.ok(pub.body.certification?.summary);
    assert.ok(typeof pub.body.certification.confidence === "number");
    assert.ok(Array.isArray(pub.body.certification.required_signals_met));
    assert.ok(Array.isArray(pub.body.signal_groups) && pub.body.signal_groups.length > 0);
  });

  it("returns 404 when public_cert_records is disabled", async () => {
    const slug = `priv-${crypto.randomBytes(4).toString("hex")}`;
    const email = `pubcert_off_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Pub Off" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);

    await human
      .post(`/api/workspaces/${ws}/policies`)
      .send({ public_slug: slug, public_cert_records: false })
      .expect(200);

    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "pub-private-v1", release_type: "model_update" })
      .expect(201);

    await human
      .post(`/api/releases/${created.body.id}/signals`)
      .send({
        source: "test",
        signals: { accuracy: 95, safety: 95, tone: 90, hallucination: 95, relevance: 90, smoke: 100, e2e_regression: 100, manual_qa_pct: 100 }
      })
      .expect(200);

    await request(app).get(`/api/public/cert/${slug}/pub-private-v1`).expect(404);
  });
});

const skipLiveGemini = process.env.GEMINI_LIVE_TEST !== "1" || !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === GEMINI_STUB;

