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
  createApp,
  writeAudit,
  seedDefaultThresholdsForTest,
  setUserRole,
  signGithubPayload,
  waitForAuditEvent,
  waitForAuditEventCount
} = require("./helpers/backendFixtures");
const { getThresholdMap } = require("../src/services/domain");
const { nowIso } = require("../src/lib/time");

describe("API auth / health / workspaces", () => {
  const app = createApp();

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health").expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.service, "verdikt-backend");
  });

  it("GET /health/ready returns database check", async () => {
    const res = await request(app).get("/health/ready").expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.checks.database, true);
  });
  it("GET /api/public/registration exposes allow_public_registration", async () => {
    const res = await request(app).get("/api/public/registration").expect(200);
    assert.equal(typeof res.body.allow_public_registration, "boolean");
  });
  it("POST /api/waitlist-requests stores a row", async () => {
    const email = `waitlist_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const res = await request(app)
      .post("/api/waitlist-requests")
      .send({
        name: "Pat Example",
        email,
        company: "Acme Labs",
        q_role: "quality_qe",
        q_team_size: "6_20",
        q_release_process: "ticket_some",
        q_pain_points: ["compliance", "eng_time"],
        q_goal: "Defensible release record",
        message: "Interested in beta"
      })
      .expect(201);
    assert.equal(res.body.ok, true);
    const row = await queryOne("SELECT * FROM waitlist_requests WHERE email = $1", [email]);
    assert.ok(row);
    assert.equal(row.name, "Pat Example");
    assert.equal(row.company, "Acme Labs");
    assert.equal(row.q_role, "quality_qe");
    assert.equal(row.q_team_size, "6_20");
    assert.equal(JSON.parse(row.q_pain_points).length, 2);
  });
  it("POST /api/waitlist-requests 400 without company", async () => {
    await request(app)
      .post("/api/waitlist-requests")
      .send({ name: "A", email: "a@test.local" })
      .expect(400);
  });
  it("POST /api/waitlist-requests 400 without qualification", async () => {
    await request(app)
      .post("/api/waitlist-requests")
      .send({
        name: "A",
        email: "b@test.local",
        company: "Co"
      })
      .expect(400);
  });
  it("register + authenticated thresholds", async () => {
    const email = `t_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Test" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const th = await agent.get(`/api/workspaces/${ws}/thresholds`).expect(200);
    assert.equal(th.body.workspace_id, ws);
    assert.ok(th.body.thresholds && typeof th.body.thresholds === "object");
  });
  it("lists workspaces for signed-in user", async () => {
    const email = `wslist_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Ws List" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const list = await agent.get("/api/auth/workspaces").expect(200);
    assert.ok(Array.isArray(list.body.workspaces));
    assert.ok(list.body.workspaces.some((row) => row.workspace_id === ws));
  });
  it("lists every workspace membership for signal-sim workspace picker", async () => {
    const email = `wsmulti_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Multi Ws" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const homeWs = me.body.user.workspace_id;
    const userId = me.body.user.id;
    const partnerWs = `ws_partner_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(partnerWs);
    await run(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)",
      [partnerWs, userId, "viewer", nowIso()]
    );

    const list = await agent.get("/api/auth/workspaces").expect(200);
    const ids = list.body.workspaces.map((row) => row.workspace_id);
    assert.equal(ids.length, 2);
    assert.ok(ids.includes(homeWs));
    assert.ok(ids.includes(partnerWs));
  });
  it("includes home workspace when only invited workspace has a member row", async () => {
    const email = `wshome_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Home Ws" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const homeWs = me.body.user.workspace_id;
    const userId = me.body.user.id;
    const partnerWs = `ws_invite_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(partnerWs);
    await run("DELETE FROM workspace_members WHERE user_id = $1", [userId]);
    await run(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)",
      [partnerWs, userId, "viewer", nowIso()]
    );

    const list = await agent.get("/api/auth/workspaces").expect(200);
    const ids = list.body.workspaces.map((row) => row.workspace_id);
    assert.equal(ids.length, 2);
    assert.ok(ids.includes(homeWs));
    assert.ok(ids.includes(partnerWs));
  });
  it("lets internal workspace viewers list and inspect all active workspaces", async () => {
    const email = `ops_${crypto.randomBytes(6).toString("hex")}@internal.test`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Ops" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const homeWs = me.body.user.workspace_id;
    const partnerWs = `ws_active_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(partnerWs);
    await run(
      "INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        `rel_${crypto.randomUUID()}`,
        partnerWs,
        "v-internal-access",
        "model_update",
        "pre-prod",
        "COLLECTING",
        nowIso(),
        nowIso()
      ]
    );

    const list = await agent.get("/api/auth/workspaces").expect(200);
    const ids = list.body.workspaces.map((row) => row.workspace_id);
    assert.ok(ids.includes(homeWs));
    assert.ok(ids.includes(partnerWs));

    const releases = await agent.get(`/api/workspaces/${partnerWs}/releases?limit=50`).expect(200);
    assert.equal(releases.body.workspace_id, partnerWs);
    assert.equal(releases.body.releases.length, 1);
  });
  it("viewer role cannot mutate thresholds (RBAC)", async () => {
    const email = `view_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Viewer" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const uid = me.body.user.id;
    await setUserRole(uid, ws, "viewer");

    await agent
      .post(`/api/workspaces/${ws}/thresholds`)
      .send({ thresholds: { accuracy: { min: 80, max: 100 } } })
      .expect(403);
  });
  it("engineer role cannot mutate thresholds (RBAC)", async () => {
    const email = `eng_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Engineer" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const uid = me.body.user.id;
    await setUserRole(uid, ws, "engineer");

    await agent
      .post(`/api/workspaces/${ws}/thresholds`)
      .send({ thresholds: { accuracy: { min: 80, max: 100 } } })
      .expect(403);
  });
  it("outbound webhook rejects private URLs (SSRF guard)", async () => {
    const email = `owh_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "OWH" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const blocked = await agent
      .put(`/api/workspaces/${ws}/outbound-webhook`)
      .send({ url: "http://127.0.0.1/callback", secret: "s3cret" })
      .expect(400);
    assert.match(blocked.body.message || blocked.body.error, /not allowed|private|link-local/i);

    const ok = await agent
      .put(`/api/workspaces/${ws}/outbound-webhook`)
      .send({ url: "http://93.184.216.34/verdikt-hook", secret: "s3cret" })
      .expect(200);
    assert.equal(ok.body.url, "http://93.184.216.34/verdikt-hook");
  });
  it("password reset invalidates existing session cookies", async () => {
    const email = `pwd_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Pwd" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    await agent.get("/api/auth/me").expect(200);

    const forgot = await agent.post("/api/auth/forgot-password").send({ email }).expect(200);
    assert.ok(forgot.body.reset_token);

    await agent
      .post("/api/auth/reset-password")
      .send({ token: forgot.body.reset_token, password: "newpassword12" })
      .expect(200);

    await agent.get("/api/auth/me").expect(401);
  });
  it("GET /api/signal-definitions requires auth", async () => {
    await request(app).get("/api/signal-definitions").expect(401);
  });
  it("GET workspace audit supports limit and before cursor pagination", async () => {
    const email = `aud_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Aud" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const page1 = await agent.get(`/api/workspaces/${ws}/audit?limit=2`).expect(200);
    assert.ok(Array.isArray(page1.body.events));
    if (page1.body.events.length === 2) {
      assert.ok(page1.body.next_before);
      const page2 = await agent
        .get(`/api/workspaces/${ws}/audit?limit=2&before=${page1.body.next_before}`)
        .expect(200);
      assert.ok(page2.body.events.every((e) => e.id < page1.body.next_before));
    }
  });
  it("forgot-password + reset-password updates login credentials", async () => {
    const email = `rp_${crypto.randomBytes(6).toString("hex")}@test.local`;
    await request(app).post("/api/auth/register").send({ email, password: "oldpass12", name: "RP" }).expect(200);
    await request(app).post("/api/auth/login").send({ email, password: "oldpass12" }).expect(200);

    const forgot = await request(app).post("/api/auth/forgot-password").send({ email }).expect(200);
    assert.equal(forgot.body.ok, true);
    assert.ok(typeof forgot.body.reset_token === "string");
    const token = forgot.body.reset_token;

    await request(app).post("/api/auth/reset-password").send({ token, password: "newpass123" }).expect(200);

    await request(app).post("/api/auth/login").send({ email, password: "oldpass12" }).expect(401);

    await request(app).post("/api/auth/login").send({ email, password: "newpass123" }).expect(200);
  });
  it("reset-password rejects invalid token", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "invalid-token-xxxxxxxx", password: "newpass123" })
      .expect(400);
    assert.match(String(res.body.message || res.body.error || ""), /invalid|expired/i);
    assert.equal(res.body.error, "bad_request");
    assert.ok(res.body.request_id);
  });
});
