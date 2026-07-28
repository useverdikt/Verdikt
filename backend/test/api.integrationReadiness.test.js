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
  GEMINI_STUB,
  createApp,
  writeAudit,
  ensureWorkspaceSeeded,
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

describe("Integration readiness (SHA tagging)", () => {
  const app = createApp();

  it("returns partner checklist and probe accepts commit_sha", async () => {
    const email = `ready_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Ready" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const checklist = await human.get(`/api/workspaces/${ws}/integration-readiness`).expect(200);
    assert.ok(Array.isArray(checklist.body.integrations));
    assert.ok(checklist.body.integrations.length >= 5);
    assert.equal(checklist.body.sha_tagging_required, true);
    assert.ok(checklist.body.partner_checklist?.length >= 3);

    const sha = crypto.randomBytes(20).toString("hex");
    const probe = await human
      .post(`/api/workspaces/${ws}/integration-readiness/probe`)
      .send({ commit_sha: sha })
      .expect(200);
    assert.equal(probe.body.commit_sha, sha);
    assert.ok(Array.isArray(probe.body.probes));
  });
});

