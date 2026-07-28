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

describe("postVerdictEffects side-effects", () => {
  const app = createApp();

  it("verdict is issued and SSE broadcast does not throw on UNCERTIFIED release", async () => {
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
        signals: { accuracy: 50, safety: 50, tone: 50, hallucination: 50, relevance: 50, smoke: 0, e2e_regression: 0, manual_qa_pct: 50 }
      })
      .expect(200);

    assert.equal(ingest.body.status, "UNCERTIFIED");
    // Confirm gate reflects UNCERTIFIED + provides remediation context
    const gate = await agent.get(`/api/releases/${created.body.id}/gate`).expect(200);
    assert.ok(["escalate", "self_heal"].includes(gate.body.action));
    assert.ok(gate.body.remediation, "remediation should be present on UNCERTIFIED gate");
    assert.strictEqual(gate.body.certification, null, "certification should be null on UNCERTIFIED gate");
  });

  it("outbound webhook payload includes certification context when CERTIFIED", async () => {
    const { buildSlackPayload } = require("../src/services/slackNotifier");
    const release = {
      id: "r_test_cert",
      workspace_id: "ws_test",
      version: "v1.2.3",
      release_type: "model_update",
      environment: "staging",
      status: "CERTIFIED",
      pr_number: 99,
      verdict_issued_at: nowIso()
    };
    const cert = {
      summary: "All required signals met. No regression detected.",
      required_signals_met: ["accuracy", "safety"],
      monitoring_note: "Ship with normal monitoring."
    };
    const payload = buildSlackPayload(release, [], cert);
    assert.ok(payload.attachments?.length, "slack payload should have attachments");
    const body = JSON.stringify(payload);
    assert.ok(body.includes("All required signals met"), "summary should be in slack payload");
    assert.ok(body.includes("accuracy"), "required signal chip should be in slack payload");
    assert.equal(payload.attachments[0].color, "#059669", "certified color should be green");
  });

  it("outbound webhook payload includes failing signals when UNCERTIFIED", async () => {
    const { buildSlackPayload } = require("../src/services/slackNotifier");
    const release = {
      id: "r_test_unc",
      workspace_id: "ws_test",
      version: "v1.2.4",
      release_type: "model_update",
      environment: "staging",
      status: "UNCERTIFIED",
      verdict_issued_at: nowIso()
    };
    const failedSignals = [
      { signal_id: "accuracy", value: 60, threshold: 85 },
      { signal_id: "safety", value: 72, threshold: 90 }
    ];
    const payload = buildSlackPayload(release, failedSignals, null);
    const body = JSON.stringify(payload);
    assert.ok(body.includes("accuracy"), "failed signal should appear in slack payload");
    assert.ok(body.includes("safety"), "failed signal should appear in slack payload");
    assert.equal(payload.attachments[0].color, "#dc2626", "uncertified color should be red");
  });

  it("buildCalibrationSlackPayload surfaces MISS alignment and threshold suggestions", () => {
    const { buildCalibrationSlackPayload } = require("../src/services/slackNotifier");
    const release = { version: "v2.1.0", release_type: "model_update" };
    const alignmentResult = {
      alignment: "MISS",
      actualOutcome: "DEGRADED",
      criteria_triggers: [{ signal: "accuracy", label: "accuracy dropped 12% post-deploy" }]
    };
    const suggestions = [
      {
        signal_id: "accuracy",
        direction: "min",
        current: 85,
        suggested: 89.25,
        alignment: "MISS",
        reason: "Consider raising floor"
      }
    ];
    const payload = buildCalibrationSlackPayload(release, alignmentResult, suggestions);
    const body = JSON.stringify(payload);
    assert.ok(body.includes("Production MISS"), "headline should mention MISS");
    assert.ok(body.includes("accuracy"), "suggestion signal should appear");
    assert.equal(payload.attachments[0].color, "#dc2626");
  });

  it("buildSlackPayload returns empty-state gracefully when no cert and no failed signals", () => {
    const { buildSlackPayload } = require("../src/services/slackNotifier");
    const release = {
      id: "r_noslack",
      workspace_id: "ws_noslack",
      version: "v0.0.1",
      release_type: "model_update",
      status: "COLLECTING",
      verdict_issued_at: nowIso()
    };
    const payload = buildSlackPayload(release, [], null);
    assert.ok(payload.attachments?.length, "should still produce an attachment");
    const body = JSON.stringify(payload);
    assert.ok(body.includes("v0.0.1"), "version should appear in payload");
    assert.equal(payload.attachments[0].color, "#6366f1", "collecting color should be indigo");
  });
});

