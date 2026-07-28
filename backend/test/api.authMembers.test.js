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

describe("Workspace members", () => {
  const app = createApp();

  it("invites a colleague and registers them into the same workspace", async () => {
    const ownerEmail = `own_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const colleagueEmail = `col_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const owner = request.agent(app);
    await owner.post("/api/auth/register").send({ email: ownerEmail, password: "password123", name: "Owner" }).expect(200);
    await owner.post("/api/auth/login").send({ email: ownerEmail, password: "password123" }).expect(200);
    const me = await owner.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const invited = await owner
      .post(`/api/workspaces/${ws}/members/invite`)
      .send({ email: colleagueEmail, role: "vp_engineering" })
      .expect(201);
    assert.ok(invited.body.invite.token);

    const colleague = request.agent(app);
    const reg = await colleague
      .post("/api/auth/register")
      .send({
        email: colleagueEmail,
        password: "password123",
        name: "Colleague",
        invite_token: invited.body.invite.token
      })
      .expect(200);
    assert.equal(reg.body.joined_workspace, true);

    await colleague.post("/api/auth/login").send({ email: colleagueEmail, password: "password123" }).expect(200);
    const colleagueMe = await colleague.get("/api/auth/me").expect(200);
    assert.equal(colleagueMe.body.user.workspace_id, ws);
    assert.equal(colleagueMe.body.user.role, "vp_engineering");

    const releases = await colleague.get(`/api/workspaces/${ws}/releases`).expect(200);
    assert.ok(Array.isArray(releases.body.releases));

    const members = await owner.get(`/api/workspaces/${ws}/members`).expect(200);
    assert.equal(members.body.members.length, 2);
  });

  it("rejects member mutations from non-admin roles", async () => {
    const ownerEmail = `own2_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const engineerEmail = `eng_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const owner = request.agent(app);
    await owner.post("/api/auth/register").send({ email: ownerEmail, password: "password123", name: "Owner2" }).expect(200);
    await owner.post("/api/auth/login").send({ email: ownerEmail, password: "password123" }).expect(200);
    const me = await owner.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const invited = await owner
      .post(`/api/workspaces/${ws}/members/invite`)
      .send({ email: engineerEmail, role: "engineer" })
      .expect(201);

    const engineer = request.agent(app);
    await engineer
      .post("/api/auth/register")
      .send({
        email: engineerEmail,
        password: "password123",
        name: "Engineer",
        invite_token: invited.body.invite.token
      })
      .expect(200);
    await engineer.post("/api/auth/login").send({ email: engineerEmail, password: "password123" }).expect(200);
    const engineerMe = await engineer.get("/api/auth/me").expect(200);

    await engineer
      .post(`/api/workspaces/${ws}/members/invite`)
      .send({ email: `blocked_${crypto.randomBytes(4).toString("hex")}@test.local`, role: "engineer" })
      .expect(403);

    await engineer
      .patch(`/api/workspaces/${ws}/members/${engineerMe.body.user.id}`)
      .send({ role: "org_admin" })
      .expect(403);
  });
});

