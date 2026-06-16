"use strict";

/**
 * Integration + unit tests. Requires PostgreSQL (DATABASE_URL or TEST_DATABASE_URL).
 * Create a test DB once: createdb verdikt_test
 * Run: npm test
 */

const crypto = require("crypto");

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.GITHUB_WEBHOOK_SECRET = "test-github-webhook-secret-32-min";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";
process.env.INTERNAL_WORKSPACE_VIEWER_EMAILS = "@internal.test";
/** Enable assistive path for llmAssist tests (mocked fetch — no real API calls). */
process.env.ENABLE_ASSISTIVE_LLM = "1";
/** Never hit live Gemini in CI/automated runs — repo secrets may set GEMINI_API_KEY. */
const GEMINI_STUB = "unit-test-stub-gemini-key-not-for-production-use";
if (process.env.GEMINI_LIVE_TEST !== "1") {
  process.env.GEMINI_LIVE_TEST = "0";
  process.env.GEMINI_API_KEY = GEMINI_STUB;
} else if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = GEMINI_STUB;
}

const { describe, it, after, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { initDatabase, queryOne, run } = require("../src/database");
const { createApp } = require("../src/app");
const {
  computeVerdict,
  ensureWorkspaceSeeded,
  getThresholdMap,
  assessOverrideJustification,
  evaluateReleaseAfterSignalIngest
} = require("../src/services/domain");
const { getMissingRequiredSignals } = require("../src/services/verdictEngine");
const { analyzeReleaseDeltas } = require("../src/services/delta");
const sharedPkg = require("../src/lib/sharedPkg");
const { nowIso } = require("../src/lib/time");
const { maybeEnrichVerdictIntelligence } = require("../src/services/llmAssist");

/** Seed full default threshold rows for unit tests that exercise verdict/delta logic. */
async function seedDefaultThresholdsForTest(workspaceId) {
  await ensureWorkspaceSeeded(workspaceId);
  const countRow = await queryOne("SELECT COUNT(*) AS c FROM thresholds WHERE workspace_id = ?", [workspaceId]);
  if (Number(countRow?.c || 0) > 0) return;
  const defaults = sharedPkg.getDefaultThresholdSeedRows();
  const defaultRequired = new Set(sharedPkg.defaultRequiredSignalIds || []);
  const insertSql =
    "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification) VALUES (?, ?, ?, ?, ?)";
  for (const row of defaults) {
    await run(insertSql, [workspaceId, row[0], row[1], row[2], defaultRequired.has(row[0]) ? 1 : 0]);
  }
}
const { callIntelligenceModel } = require("../src/services/aiClient");
const { upsertReleaseIntelligence, getReleaseIntelligence } = require("../src/services/intelligenceBuilder");
const { computeAndPersistRecommendation, getRecommendation } = require("../src/services/recommendationEngine");

before(async () => {
  await initDatabase();
});

describe("API integration", () => {
  const app = createApp();

  async function setUserRole(userId, workspaceId, role) {
    await run("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
    await run("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?", [
      role,
      workspaceId,
      userId
    ]);
  }

  function signGithubPayload(payload) {
    const raw = JSON.stringify(payload);
    const sig = crypto
      .createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET)
      .update(raw)
      .digest("hex");
    return { raw, sig: `sha256=${sig}` };
  }

  async function waitForAuditEvent(releaseId, eventType, { timeoutMs = 5000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const row = await queryOne(
        "SELECT * FROM audit_events WHERE release_id = ? AND event_type = ? ORDER BY id DESC LIMIT 1",
        [releaseId, eventType]
      );
      if (row) return row;
      await new Promise((r) => setTimeout(r, 30));
    }
    return null;
  }

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
    const row = await queryOne("SELECT * FROM waitlist_requests WHERE email = ?", [email]);
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
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
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
    await run("DELETE FROM workspace_members WHERE user_id = ?", [userId]);
    await run(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
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
      "INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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
    assert.match(blocked.body.error, /not allowed|private|link-local/i);

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

  it("signal-integrations: PUT verifies (skipped in test) and lists", async () => {
    const email = `sig_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Sig" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const put = await agent
      .put(`/api/workspaces/${ws}/signal-integrations/sentry`)
      .send({ apiKey: "sntry_test_fake_token_for_ci_xxxxxxxx" })
      .expect(200);
    assert.ok(put.body.masked_key);
    assert.ok(put.body.verified_at);

    const list = await agent.get(`/api/workspaces/${ws}/signal-integrations`).expect(200);
    assert.equal(list.body.integrations.length, 1);
    assert.equal(list.body.integrations[0].source_id, "sentry");

    await agent.delete(`/api/workspaces/${ws}/signal-integrations/sentry`).expect(200);

    const empty = await agent.get(`/api/workspaces/${ws}/signal-integrations`).expect(200);
    assert.equal(empty.body.integrations.length, 0);
  });

  it("signal-integrations panel includes pull_connectors and integration-requests POST", async () => {
    const email = `panel_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Panel" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const list = await agent.get(`/api/workspaces/${ws}/signal-integrations`).expect(200);
    assert.ok(Array.isArray(list.body.pull_connectors));
    assert.ok(list.body.pull_connectors.some((c) => c.source_id === "langsmith"));
    assert.ok(list.body.api_push?.ingest_path);

    const req = await agent
      .post(`/api/workspaces/${ws}/integration-requests`)
      .send({ source_name: "W&B", notes: "Eval metrics" })
      .expect(201);
    assert.equal(req.body.source_name, "W&B");
    assert.equal(req.body.status, "pending");

    const after = await agent.get(`/api/workspaces/${ws}/signal-integrations`).expect(200);
    assert.equal(after.body.integration_requests.length, 1);
    assert.equal(after.body.integration_requests[0].source_name, "W&B");
  });

  it("datadog integration rejects unsupported site (SSRF guard)", async () => {
    const email = `dd_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "DD" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const bad = await agent
      .put(`/api/workspaces/${ws}/signal-integrations/datadog`)
      .send({ apiKey: "dd_test_api_key", appKey: "dd_test_app_key", site: "evil.example.com" })
      .expect(400);
    assert.match(bad.body.error, /Unsupported Datadog site/i);

    const ok = await agent
      .put(`/api/workspaces/${ws}/signal-integrations/datadog`)
      .send({ apiKey: "dd_test_api_key", appKey: "dd_test_app_key", site: "datadoghq.eu" })
      .expect(200);
    assert.equal(ok.body.source_id, "datadog");
  });

  it("github label trigger config can be set and cleared", async () => {
    const email = `ghcfg_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GH" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const initial = await agent.get(`/api/workspaces/${ws}/github-label-trigger`).expect(200);
    assert.equal(initial.body.enabled, false);
    assert.equal(initial.body.label_name, "verdikt:rc");

    const saved = await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "release:certify", enabled: true })
      .expect(200);
    assert.equal(saved.body.enabled, true);
    assert.equal(saved.body.label_name, "release:certify");

    const cleared = await agent.delete(`/api/workspaces/${ws}/github-label-trigger`).expect(200);
    assert.equal(cleared.body.ok, true);

    const afterDelete = await agent.get(`/api/workspaces/${ws}/github-label-trigger`).expect(200);
    assert.equal(afterDelete.body.enabled, false);
    assert.equal(afterDelete.body.label_name, "verdikt:rc");
  });

  it("GitHub label trigger uses PR title and auto-classifies release type", async () => {
    // Use random PR number and SHA so repeated test runs don't hit the stable idempotency key.
    const prNumber = 40000 + crypto.randomInt(9999);
    const sha = crypto.randomBytes(8).toString("hex");
    const email = `ght_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const repo = `VerdiktTitle${crypto.randomBytes(3).toString("hex")}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHT" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "verdikt:rc", enabled: true })
      .expect(200);

    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: {
        number: prNumber,
        title: "Safety hotfix for policy routing",
        html_url: `https://github.com/useverdikt/${repo}/pull/${prNumber}`,
        labels: [{ name: "safety" }],
        head: { sha, ref: "fix/safety-routing" }
      }
    };
    const signed = signGithubPayload(payload);

    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(201);

    const rel = await queryOne("SELECT * FROM releases WHERE id = ?", [hook.body.release_id]);
    assert.equal(rel.workspace_id, ws);
    assert.equal(rel.version, `Safety hotfix for policy routing (#${prNumber})`);
    assert.equal(rel.release_type, "safety_patch");
    assert.equal(rel.environment, "pre-prod");
    assert.equal(Number(rel.pr_number), prNumber);
    const aiContext = JSON.parse(rel.ai_context_json || "{}");
    assert.equal(aiContext.legacy_release_ref, `pr/${prNumber}@${sha.slice(0, 8)}`);
    assert.equal(aiContext.release_type_auto, "safety_patch");
  });

  it("GitHub label trigger falls back to legacy PR ref when title is missing", async () => {
    const prNumber = 50000 + crypto.randomInt(9999);
    const sha = crypto.randomBytes(8).toString("hex");
    const email = `ghf_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const repo = `FallbackTitle${crypto.randomBytes(3).toString("hex")}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHF" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "verdikt:rc", enabled: true })
      .expect(200);

    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: {
        number: prNumber,
        title: "",
        html_url: `https://github.com/useverdikt/${repo}/pull/${prNumber}`,
        labels: [],
        head: { sha, ref: "feature/no-title" }
      }
    };
    const signed = signGithubPayload(payload);

    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(201);

    const rel = await queryOne("SELECT * FROM releases WHERE id = ?", [hook.body.release_id]);
    assert.equal(rel.version, `pr/${prNumber}@${sha.slice(0, 8)}`);
    assert.equal(rel.release_type, "model_update");
  });

  it("GitHub label trigger deduplicates repeated deliveries for the same PR commit", async () => {
    const prNumber = 90000 + crypto.randomInt(9999);
    const sha = crypto.randomBytes(8).toString("hex");
    const email = `ghd_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const repo = `DedupRepo${crypto.randomBytes(3).toString("hex")}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHD" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "verdikt:rc", enabled: true })
      .expect(200);

    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: {
        number: prNumber,
        title: "Duplicate delivery dedupe check",
        html_url: `https://github.com/useverdikt/${repo}/pull/${prNumber}`,
        labels: [{ name: "verdikt:rc" }],
        head: { sha, ref: "fix/dedupe" }
      }
    };
    const signed = signGithubPayload(payload);

    const first = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(201);

    const second = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(200);

    assert.equal(second.body.reused, true);
    assert.equal(second.body.release_id, first.body.release_id);

    const count = await queryOne(
      "SELECT COUNT(*) AS c FROM releases WHERE workspace_id = ? AND pr_number = ? AND commit_sha = ?",
      [ws, prNumber, sha]
    );
    assert.equal(Number(count?.c || 0), 1);
  });

  it("GitHub label trigger schedules async integration pull from connected sources", async () => {
    const prNumber = 95000 + crypto.randomInt(9999);
    const sha = crypto.randomBytes(8).toString("hex");
    const email = `ghpull_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const repo = `PullOnLabel${crypto.randomBytes(3).toString("hex")}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHPull" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "verdikt:rc", enabled: true })
      .expect(200);
    await agent.put(`/api/workspaces/${ws}/signal-integrations/braintrust`).send({ apiKey: "bt_test_mock_key" }).expect(200);

    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: {
        number: prNumber,
        title: "Auto pull on label",
        html_url: `https://github.com/useverdikt/${repo}/pull/${prNumber}`,
        labels: [{ name: "verdikt:rc" }],
        head: { sha, ref: "feat/auto-pull" }
      }
    };
    const signed = signGithubPayload(payload);

    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(201);

    const audit = await waitForAuditEvent(hook.body.release_id, "SIGNAL_SOURCES_PULL");
    assert.ok(audit, "expected async SIGNAL_SOURCES_PULL audit after label trigger");
    assert.equal(audit.actor_type, "SYSTEM");
    assert.equal(audit.actor_name, "github_label_trigger");
    const details = JSON.parse(audit.details_json || "{}");
    assert.equal(details.trigger, "github_label");
    assert.equal(details.async, true);
    assert.ok(Array.isArray(details.sources));

    const signalCount = await queryOne(
      "SELECT COUNT(*) AS c FROM signals WHERE release_id = ? AND source = ?",
      [hook.body.release_id, "pulled:braintrust"]
    );
    assert.ok(Number(signalCount?.c || 0) > 0);

    const reused = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(200);

    assert.equal(reused.body.reused, true);
    const auditReused = await waitForAuditEvent(hook.body.release_id, "SIGNAL_SOURCES_PULL");
    assert.ok(auditReused);
    const pullCount = await queryOne(
      "SELECT COUNT(*) AS c FROM audit_events WHERE release_id = ? AND event_type = ?",
      [hook.body.release_id, "SIGNAL_SOURCES_PULL"]
    );
    assert.ok(Number(pullCount?.c || 0) >= 2);
  });

  it("GitHub label trigger deduplicates concurrent simultaneous deliveries (race condition)", async () => {
    const prNumber = 70000 + crypto.randomInt(9999);
    const sha = crypto.randomBytes(8).toString("hex");
    const repo = `RaceRepo${crypto.randomBytes(3).toString("hex")}`;
    const email = `ghrace_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHRACE" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    await agent
      .put(`/api/workspaces/${ws}/github-label-trigger`)
      .send({ label_name: "verdikt:rc", enabled: true })
      .expect(200);

    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: {
        number: prNumber,
        title: "Race condition check",
        html_url: `https://github.com/useverdikt/${repo}/pull/${prNumber}`,
        labels: [{ name: "verdikt:rc" }],
        head: { sha, ref: "fix/race" }
      }
    };
    const signed = signGithubPayload(payload);

    // Fire both requests simultaneously — only one should create a release.
    const [r1, r2] = await Promise.all([
      request(app)
        .post("/api/hooks/github")
        .set("content-type", "application/json")
        .set("x-github-event", "pull_request")
        .set("x-github-delivery", `race-a-${crypto.randomBytes(4).toString("hex")}`)
        .set("x-hub-signature-256", signed.sig)
        .send(signed.raw),
      request(app)
        .post("/api/hooks/github")
        .set("content-type", "application/json")
        .set("x-github-event", "pull_request")
        .set("x-github-delivery", `race-b-${crypto.randomBytes(4).toString("hex")}`)
        .set("x-hub-signature-256", signed.sig)
        .send(signed.raw),
    ]);

    assert.ok([200, 201].includes(r1.status), `r1 status ${r1.status}`);
    assert.ok([200, 201].includes(r2.status), `r2 status ${r2.status}`);
    const count = await queryOne(
      "SELECT COUNT(*) AS c FROM releases WHERE workspace_id = ? AND pr_number = ? AND commit_sha = ?",
      [ws, prNumber, sha]
    );
    assert.equal(Number(count?.c || 0), 1, "exactly one release row should exist");
    const created = [r1, r2].filter((r) => r.status === 201);
    const reused = [r1, r2].filter((r) => r.status === 200 && r.body.reused);
    assert.equal(created.length + reused.length, 2, "both deliveries should succeed");
    assert.equal(created.length, 1, "exactly one release should be created");
    assert.equal(reused.length, 1, "exactly one should be marked reused");
    const releaseId = created[0]?.body?.release_id || reused[0]?.body?.release_id;
    assert.ok(releaseId, "expected a release_id on create or reuse response");
    if (created[0]?.body?.release_id && reused[0]?.body?.release_id) {
      assert.equal(reused[0].body.release_id, created[0].body.release_id);
    }
  });

  it("GitHub merge blocks prod promotion while release is still collecting", async () => {
    const email = `ghb_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHB" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo: "PromoteBlock" })
      .expect(200);
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Collecting PR (#6161)", release_type: "model_update", environment: "pre-prod", pr_number: 6161 })
      .expect(201);

    const payload = {
      action: "closed",
      repository: { name: "PromoteBlock", owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 6161, base: { ref: "main" } }
    };
    const signed = signGithubPayload(payload);
    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(200);

    assert.equal(hook.body.promoted, 0);
    assert.equal(hook.body.blocked_collecting, 1);
    const rel = await queryOne("SELECT environment FROM releases WHERE id = ?", [created.body.id]);
    assert.equal(rel.environment, "pre-prod");
    const audit = await queryOne(
      "SELECT * FROM audit_events WHERE release_id = ? AND event_type = ? ORDER BY id DESC LIMIT 1",
      [created.body.id, "RELEASE_ENV_PROMOTION_BLOCKED"]
    );
    assert.ok(audit);
  });

  it("GET /detail returns expand payload without audit; full GET includes audit", async () => {
    const email = `det_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Det" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Detail split test", release_type: "model_update", environment: "pre-prod" })
      .expect(201);
    const relId = created.body.id;

    await agent
      .post(`/api/releases/${relId}/signals`)
      .send({ source: "simulator:test", signals: { accuracy: 90, safety: 95, tone: 90, hallucination: 95, relevance: 85 } })
      .expect(200);

    const detail = await agent.get(`/api/releases/${relId}/detail`).expect(200);
    assert.ok(Array.isArray(detail.body.signals));
    assert.ok(detail.body.release);
    assert.equal("audit" in detail.body, false);

    const full = await agent.get(`/api/releases/${relId}`).expect(200);
    assert.ok(Array.isArray(full.body.audit));
    assert.ok(full.body.signals.length >= 1);
  });

  it("duplicate signal idempotency key replays read-only without new audit events", async () => {
    const email = `dup_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Dup" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Idempotency replay test", release_type: "model_update", environment: "pre-prod" })
      .expect(201);
    const relId = created.body.id;
    const idempotencyKey = `dup-key-${crypto.randomBytes(4).toString("hex")}`;
    const payload = {
      source: "test",
      idempotency_key: idempotencyKey,
      signals: { accuracy: 90, safety: 95, tone: 90, hallucination: 95, relevance: 85 }
    };

    await agent.post(`/api/releases/${relId}/signals`).send(payload).expect(200);
    const auditBefore = await queryOne("SELECT COUNT(*) AS c FROM audit_events WHERE release_id = ?", [relId]);

    const replay = await agent.post(`/api/releases/${relId}/signals`).send(payload).expect(200);
    assert.equal(replay.body.duplicate, true);
    assert.equal(replay.body.release_id, relId);

    const auditAfter = await queryOne("SELECT COUNT(*) AS c FROM audit_events WHERE release_id = ?", [relId]);
    assert.equal(Number(auditAfter.c), Number(auditBefore.c));
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

  it("loop-readiness returns cached on repeat request", async () => {
    const email = `lrc_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Lrc" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent.get(`/api/workspaces/${ws}/loop-readiness`).expect(200);
    const second = await agent.get(`/api/workspaces/${ws}/loop-readiness`).expect(200);
    assert.equal(second.body.cached, true);
  });

  it("GET /releases/:id/audit supports pagination", async () => {
    const email = `rau_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "RAu" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Release audit page", release_type: "model_update", environment: "pre-prod" })
      .expect(201);
    const relId = created.body.id;

    await agent
      .post(`/api/releases/${relId}/signals`)
      .send({ source: "test", signals: { accuracy: 90, safety: 95, tone: 90, hallucination: 95, relevance: 85 } })
      .expect(200);

    const page = await agent.get(`/api/releases/${relId}/audit?limit=5`).expect(200);
    assert.equal(page.body.release_id, relId);
    assert.ok(Array.isArray(page.body.events));
    assert.ok(page.body.events.length >= 1);
    assert.ok(page.body.events[0].event_type);
  });

  it("GitHub merge promotes to prod after verdict is issued", async () => {
    const email = `ghp_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHP" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo: "PromoteOk" })
      .expect(200);
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Certified PR (#7171)", release_type: "model_update", environment: "pre-prod", pr_number: 7171 })
      .expect(201);
    await run("UPDATE releases SET status = ?, verdict_issued_at = ? WHERE id = ?", ["CERTIFIED", nowIso(), created.body.id]);

    const payload = {
      action: "closed",
      repository: { name: "PromoteOk", owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 7171, base: { ref: "main" } }
    };
    const signed = signGithubPayload(payload);
    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(200);

    assert.equal(hook.body.promoted, 1);
    assert.equal(hook.body.blocked_collecting, 0);
    assert.equal(hook.body.environment, "prod");
    const rel = await queryOne("SELECT environment FROM releases WHERE id = ?", [created.body.id]);
    assert.equal(rel.environment, "prod");
  });

  it("merged-to-main while collecting auto-promotes to prod after verdict", async () => {
    const email = `ghpv_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "GHPV" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const repo = `PromoteAfterVerdict${crypto.randomBytes(3).toString("hex")}`;
    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);
    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Collect then promote (#8282)", release_type: "model_update", pr_number: 8282 })
      .expect(201);

    const mergePayload = {
      action: "closed",
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 8282, base: { ref: "main" } }
    };
    const signedMerge = signGithubPayload(mergePayload);
    const hook = await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signedMerge.sig)
      .send(signedMerge.raw)
      .expect(200);
    assert.equal(hook.body.promoted, 0);
    assert.equal(hook.body.blocked_collecting, 1);

    await run("UPDATE releases SET collection_deadline = ? WHERE id = ?", [
      new Date(Date.now() - 60_000).toISOString(),
      created.body.id
    ]);
    await agent
      .post(`/api/releases/${created.body.id}/signals`)
      .send({
        source: "test",
        signals: {
          accuracy: 90,
          safety: 95,
          tone: 90,
          hallucination: 95,
          relevance: 85
        }
      })
      .expect(200);

    const rel = await queryOne("SELECT environment, status FROM releases WHERE id = ?", [created.body.id]);
    assert.equal(rel.environment, "prod");
    assert.equal(rel.status, "CERTIFIED");
  });

  it("manual release creation always starts in pre-prod", async () => {
    const email = `env_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "ENV" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-env-guard-1", release_type: "model_update", environment: "prod" })
      .expect(201);

    assert.equal(created.body.environment, "pre-prod");
    const rel = await queryOne("SELECT environment FROM releases WHERE id = ?", [created.body.id]);
    assert.equal(rel.environment, "pre-prod");
  });

  it("extends collection deadline for COLLECTING releases", async () => {
    const email = `extend_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "EXT" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-extend-deadline-1", release_type: "model_update" })
      .expect(201);
    assert.equal(created.body.status, "COLLECTING");
    const before = await queryOne("SELECT collection_deadline FROM releases WHERE id = ?", [created.body.id]);
    assert.ok(before.collection_deadline);

    const extended = await agent
      .post(`/api/releases/${created.body.id}/collection-deadline/extend`)
      .send({ extend_minutes: 10 })
      .expect(200);
    assert.ok(extended.body.collection_deadline);
    assert.equal(extended.body.extend_minutes, 10);
    assert.ok(Date.parse(extended.body.collection_deadline) > Date.parse(before.collection_deadline));

    const after = await queryOne("SELECT collection_deadline FROM releases WHERE id = ?", [created.body.id]);
    assert.equal(after.collection_deadline, extended.body.collection_deadline);

    await run("UPDATE releases SET status = 'CERTIFIED' WHERE id = ?", [created.body.id]);
    await agent.post(`/api/releases/${created.body.id}/collection-deadline/extend`).send({ extend_minutes: 5 }).expect(409);
  });

  it("RLS is enabled for public GitHub config tables", async () => {
    const tables = [
      "workspace_inbound_webhook_secrets",
      "github_label_triggers",
      "github_app_installations",
      "github_app_install_states",
      "github_repo_connections"
    ];
    for (const table of tables) {
      const row = await queryOne(
        "SELECT relrowsecurity AS enabled FROM pg_class WHERE oid = ?::regclass",
        [`public.${table}`]
      );
      assert.equal(row.enabled, true, `${table} should have RLS enabled`);
    }
  });

  it("CSV import stores rows and applies signals to release by version", async () => {
    const email = `csv_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "CSV" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-csv-apply-1", release_type: "model_update" })
      .expect(201);

    const csvBody = "version,accuracy,safety\nv-csv-apply-1,91,90\n";
    const up = await agent
      .post(`/api/workspaces/${ws}/signal-csv-imports`)
      .attach("file", Buffer.from(csvBody, "utf8"), "signals.csv")
      .expect(200);
    assert.equal(up.body.row_count, 1);
    assert.equal(up.body.apply_result.applied, true);
    assert.ok(Array.isArray(up.body.apply_result.releases));
    assert.equal(up.body.apply_result.releases.length, 1);
  });

  it("POST release sources pull invokes Braintrust path in test (mock metrics)", async () => {
    const email = `pl_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Pull" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-pull-mock-1", release_type: "model_update" })
      .expect(201);

    const list = await agent.get(`/api/workspaces/${ws}/releases`).expect(200);
    const releaseId = list.body.releases[0].id;

    await agent.put(`/api/workspaces/${ws}/signal-integrations/braintrust`).send({ apiKey: "bt_test_mock_key" }).expect(200);

    const pull = await agent.post(`/api/releases/${releaseId}/sources/pull`).expect(200);
    assert.equal(pull.body.ok, true);
    assert.equal(pull.body.sources.braintrust.ok, true);
  });

  it("POST release sources pull invokes BrowserStack path in test (mock metrics)", async () => {
    const email = `bs_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "BSPull" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-bs-pull-1", release_type: "prompt_update" })
      .expect(201);

    await agent
      .put(`/api/workspaces/${ws}/signal-integrations/browserstack`)
      .send({ username: "bs_user", apiKey: "bs_test_key" })
      .expect(200);

    const pull = await agent.post(`/api/releases/${created.body.id}/sources/pull`).expect(200);
    assert.equal(pull.body.ok, true);
    assert.equal(pull.body.sources.browserstack.ok, true);
  });

  it("required signals gate certification regardless of integration connection", async () => {
    const email = `scope_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Scope" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .put(`/api/workspaces/${ws}/signal-integrations/braintrust`)
      .send({ apiKey: "bt_scope_key" })
      .expect(200);

    await agent
      .post(`/api/workspaces/${ws}/thresholds`)
      .send({
        thresholds: {
          smoke: { min: 100, max: null, required_for_certification: true },
          crashrate: { min: null, max: 0.1, required_for_certification: true },
          accuracy: { min: 85, max: null, required_for_certification: true }
        }
      })
      .expect(200);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-scope-1", release_type: "model_patch" })
      .expect(201);

    const missing = await getMissingRequiredSignals(ws, created.body.id, {}, created.body);
    assert.ok(missing.includes("accuracy"));
    assert.ok(missing.includes("smoke"));
    assert.ok(missing.includes("crashrate"));
    assert.ok(!missing.includes("e2e_regression"));
  });

  it("legacy crashrate min rows normalize and low values pass threshold", async () => {
    const email = `thr_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Thr" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await run(
      "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification) VALUES (?, ?, ?, ?, 1) ON CONFLICT(workspace_id, signal_id) DO UPDATE SET min_value=excluded.min_value, max_value=excluded.max_value, required_for_certification=excluded.required_for_certification",
      [ws, "crashrate", 0.1, null]
    );

    const map = await getThresholdMap(ws);
    assert.equal(map.crashrate.max, 0.1);
    assert.equal(map.crashrate.min, null);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "v-crash-thr", release_type: "model_update" })
      .expect(201);

    await agent
      .put(`/api/workspaces/${ws}/signal-integrations/sentry`)
      .send({ apiKey: "sentry_scope_key" })
      .expect(200);

    const verdict = await computeVerdict(ws, created.body.id, { crashrate: 0.01 }, created.body);
    assert.equal(
      verdict.failed_signals.filter((f) => f.signal_id === "crashrate").length,
      0
    );
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
    assert.match(String(res.body.error || ""), /invalid|expired/i);
  });
});

describe("computeVerdict (unit)", () => {
  const ws = "ws_verdict_unit";
  it("CERTIFIED when AI signals meet default floors", async () => {
    await seedDefaultThresholdsForTest(ws);
    const v = await computeVerdict(
      ws,
      "rel_unused",
      {
        accuracy: 90,
        safety: 95,
        tone: 90,
        hallucination: 95,
        relevance: 85,
        p95latency: 200,
        p99latency: 400
      },
      null
    );
    assert.equal(v.status, "CERTIFIED");
    assert.equal(v.failed_signals.length, 0);
  });

  it("UNCERTIFIED on absolute threshold miss", async () => {
    await seedDefaultThresholdsForTest(ws);
    const v = await computeVerdict(ws, "rel_unused", { accuracy: 70 }, null);
    assert.equal(v.status, "UNCERTIFIED");
    const acc = v.failed_signals.find((f) => f.signal_id === "accuracy");
    assert.ok(acc);
    assert.equal(acc.failure_kind, "absolute_threshold");
  });
});

describe("evaluateReleaseAfterSignalIngest (unit)", () => {
  it("UNCERTIFIED when no signals ingested at verdict", async () => {
    const ws = `ws_no_ingest_${crypto.randomBytes(3).toString("hex")}`;
    await ensureWorkspaceSeeded(ws);
    const releaseId = `rel_ni_${crypto.randomBytes(3).toString("hex")}`;
    const now = nowIso();
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at, collection_deadline)
       VALUES (?, ?, 'v-empty', 'model_update', 'pre-prod', 'COLLECTING', ?, ?, ?)`,
      [releaseId, ws, now, now, new Date(Date.now() - 60_000).toISOString()]
    );
    const release = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
    const out = await evaluateReleaseAfterSignalIngest(release, releaseId, "test", 0);
    assert.equal(out.status, "UNCERTIFIED");
    assert.ok(out.failed_signals.some((f) => f.failure_kind === "no_ingest"));
    const row = await queryOne("SELECT status FROM releases WHERE id = ?", [releaseId]);
    assert.equal(row.status, "UNCERTIFIED");
  });

  it("preserves verdict_issued_at on re-evaluation after UNCERTIFIED", async () => {
    const ws = `ws_verdict_ts_${crypto.randomBytes(3).toString("hex")}`;
    await ensureWorkspaceSeeded(ws);
    const releaseId = `rel_vt_${crypto.randomBytes(3).toString("hex")}`;
    const firstVerdictAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const now = nowIso();
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at, verdict_issued_at, collection_deadline)
       VALUES (?, ?, 'v-re', 'model_update', 'pre-prod', 'UNCERTIFIED', ?, ?, ?, ?)`,
      [releaseId, ws, now, now, firstVerdictAt, new Date(Date.now() - 60_000).toISOString()]
    );
    await run(`INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES (?, 'accuracy', 70, 't', ?)`, [
      releaseId,
      now
    ]);
    const release = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
    await evaluateReleaseAfterSignalIngest(release, releaseId, "test", 1);
    const after = await queryOne("SELECT verdict_issued_at FROM releases WHERE id = ?", [releaseId]);
    assert.equal(after.verdict_issued_at, firstVerdictAt);
  });
});

describe("release intelligence recommendation vs user decision (unit)", () => {
  it("keeps recommendation when user records intelligence decision", async () => {
    const ws = `ws_intel_${crypto.randomBytes(3).toString("hex")}`;
    await ensureWorkspaceSeeded(ws);
    const releaseId = `rel_intel_${crypto.randomBytes(3).toString("hex")}`;
    const now = nowIso();
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at, verdict_issued_at, collection_deadline)
       VALUES (?, ?, 'v1', 'model_update', 'pre-prod', 'CERTIFIED', ?, ?, ?, ?)`,
      [releaseId, ws, now, now, now, now]
    );
    await run(`INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES (?, 'accuracy', 92, 't', ?)`, [
      releaseId,
      now
    ]);
    await run(
      `INSERT INTO audit_events (workspace_id, release_id, event_type, actor_type, actor_name, details_json, created_at)
       VALUES (?, ?, 'SIGNALS_INGESTED', 'SYSTEM', 'test', ?, ?)`,
      [ws, releaseId, JSON.stringify({ failed_signals: [], missing_required_signals: [] }), now]
    );

    const release = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
    const rec = await computeAndPersistRecommendation(release);
    assert.ok(rec.confidence_score != null);

    await upsertReleaseIntelligence(releaseId, ws, {
      decision: { decision: "shipped", notes: "", actor: "test", decided_at: now }
    });

    const intel = await getReleaseIntelligence(releaseId);
    assert.equal(intel.decision?.decision, "shipped");
    assert.equal(intel.recommendation?.confidence_score, rec.confidence_score);
    assert.ok(intel.recommendation?.recommended_verdict);

    const fetched = await getRecommendation(releaseId);
    assert.equal(fetched?.confidence_score, rec.confidence_score);
  });
});

describe("analyzeReleaseDeltas regression (unit)", () => {
  const ws = "ws_delta_unit";

  it("flags regression when drop exceeds allowed delta", async () => {
    await seedDefaultThresholdsForTest(ws);
    const oldIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const newIso = nowIso();
    const suffix = crypto.randomBytes(4).toString("hex");
    const baseId = `rel_baseline_delta_${suffix}`;
    const curId = `rel_current_delta_${suffix}`;

    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
       VALUES (?, ?, 'v0', 'model_update', 'env', 'CERTIFIED', ?, ?)`,
      [baseId, ws, oldIso, oldIso]
    );

    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
       VALUES (?, ?, 'v1', 'model_update', 'env', 'UNCERTIFIED', ?, ?)`,
      [curId, ws, newIso, newIso]
    );

    await run(
      `INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES (?, 'accuracy', 90, 't', ?)`,
      [baseId, oldIso]
    );
    await run(
      `INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES (?, 'accuracy', 78, 't', ?)`,
      [curId, newIso]
    );

    const releaseRow = await queryOne("SELECT * FROM releases WHERE id = ?", [curId]);
    const latest = { accuracy: 78 };
    const thresholdMap = await getThresholdMap(ws);
    const out = await analyzeReleaseDeltas({
      workspaceId: ws,
      releaseId: curId,
      releaseRow,
      latest,
      thresholdMap
    });

    const fail = out.failures.find((f) => f.signal_id === "accuracy");
    assert.ok(fail, "expected accuracy regression failure");
    assert.equal(fail.failure_kind, "regression");
  });
});

describe("assessOverrideJustification (unit)", () => {
  it("scores higher with substantive text and regression keywords", async () => {
    const low = await assessOverrideJustification({
      justification: "ok",
      metadata: { impact_summary: "", mitigation_plan: "", follow_up_due_date: "" },
      workspaceId: "ws1",
      regression_signals: ["accuracy"]
    });
    const high = await assessOverrideJustification({
      justification:
        "Regression isolated to legacy profile format affecting under 0.3% of sessions. We accept risk because mitigation: monitor dashboards, rollback plan documented, owner committed. Baseline eval compared to canary.",
      metadata: {
        impact_summary: "Limited cohort edge case in production.",
        mitigation_plan: "Hotfix scheduled with on-call verification and rollback if error budget exceeded.",
        follow_up_due_date: "2026-05-01"
      },
      workspaceId: "ws1",
      regression_signals: ["accuracy"]
    });
    assert.ok(high.score > low.score);
  });
});

describe("Gemini assistive enrichment (mocked API)", () => {
  it("callIntelligenceModel parses Gemini generateContent response shape", async () => {
    const prev = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '{"summary":"ok","recommended_actions":["a"]}' }]
            }
          }
        ]
      })
    });
    try {
      const text = await callIntelligenceModel('{"prompt":"x"}', { maxTokens: 200 });
      assert.ok(text.includes("summary"));
    } finally {
      global.fetch = prev;
    }
  });

  it("maybeEnrichVerdictIntelligence merges LLM summary + actions into verdict intel", async () => {
    const prev = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary:
                      "Governance note: absolute threshold miss on accuracy coexists with regression risk — prioritize baseline comparison.",
                    recommended_actions: ["Re-run eval on prior certified tag", "Escalate model review", "Document mitigation"]
                  })
                }
              ]
            }
          }
        ]
      })
    });
    try {
      const baseIntel = {
        source: "deterministic_assistive_v1",
        model: "deterministic_assistive_v1",
        risk_level: "HIGH",
        summary: "Deterministic seed summary before enrichment.",
        recommended_actions: ["Old deterministic action"],
        regression_context: null,
        regression_history: null
      };
      const out = await maybeEnrichVerdictIntelligence({
        release: { release_type: "model_update", environment: "production" },
        failedSignals: [
          {
            signal_id: "accuracy",
            failure_kind: "absolute_threshold",
            value: 70,
            rule: "min_floor"
          }
        ],
        missingRequiredSignals: [],
        intelligence: baseIntel
      });
      assert.match(out.summary, /Governance note/);
      assert.equal(out.recommended_actions[0], "Re-run eval on prior certified tag");
      assert.match(String(out.source || ""), /assistive_/);
      assert.ok(out.generated_at);
    } finally {
      global.fetch = prev;
    }
  });
});

describe("buildInboundSecretCandidates (unit)", () => {
  it("uses only workspace secret when present (no global fallback)", () => {
    const { buildInboundSecretCandidates } = require("../src/services/inboundWebhookSecrets");
    const onlyWs = buildInboundSecretCandidates("workspace-secret-abc", { allowGlobalFallbacks: true });
    assert.deepEqual(onlyWs, ["workspace-secret-abc"]);
  });

  it("falls back to global WEBHOOK_SECRET in dev when workspace secret missing", () => {
    const { buildInboundSecretCandidates } = require("../src/services/inboundWebhookSecrets");
    const globalOnly = buildInboundSecretCandidates(null, { allowGlobalFallbacks: true });
    assert.deepEqual(globalOnly, [process.env.WEBHOOK_SECRET]);
  });
});

describe("validateOutboundWebhookUrl (unit)", () => {
  it("blocks localhost and metadata-style hosts", async () => {
    const { validateOutboundWebhookUrl } = require("../src/lib/outboundUrl");
    await assert.rejects(() => validateOutboundWebhookUrl("http://127.0.0.1/hook"), /private|not allowed/i);
    await assert.rejects(() => validateOutboundWebhookUrl("http://localhost/hook"), /not allowed/i);
  });
});

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
      "SELECT COUNT(*) AS c FROM releases WHERE workspace_id = ? AND commit_sha = ? AND pr_number = ?",
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
    const sigCount = await queryOne("SELECT COUNT(*) AS c FROM signals WHERE release_id = ?", [created.body.id]);
    assert.ok(Number(sigCount?.c || 0) >= 5);
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
      "SELECT event_type, agent_session_id FROM audit_events WHERE release_id = ? AND event_type = ? ORDER BY id DESC LIMIT 1",
      [rel.body.id, "AGENT_SIGNALS_POSTED"]
    );
    assert.ok(row);
    assert.equal(row.agent_session_id, sessionId);
  });
});

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

describe("Escalation inbox", () => {
  const app = createApp();

  async function setUserRole(userId, workspaceId, role) {
    await run("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
    await run("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?", [
      role,
      workspaceId,
      userId
    ]);
  }

  it("creates inbox row, lists pending, and acknowledges with override role", async () => {
    const email = `esc_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Esc" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await human
      .post(`/api/workspaces/${ws}/policies`)
      .send({ gate_mode: "strict", escalation_sla_hours: 48, escalation_notify_email: "ops@test.local" })
      .expect(200);

    const rel = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "esc-inbox-v1", release_type: "model_update" })
      .expect(201);

    const keyRes = await human.post(`/api/workspaces/${ws}/api-keys`).send({ name: "esc-agent" }).expect(201);
    const agent = request(app);
    const esc = await agent
      .post(`/api/releases/${rel.body.id}/escalate`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({ reason: "Blocked on accuracy", blocking_signals: ["accuracy"] })
      .expect(202);
    assert.ok(String(esc.body.escalation.id).startsWith("esc_"));

    const inbox = await human.get(`/api/workspaces/${ws}/escalations`).expect(200);
    assert.equal(inbox.body.escalations.length, 1);
    assert.equal(inbox.body.escalations[0].release_id, rel.body.id);

    await setUserRole(me.body.user.id, ws, "engineer");
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    await human.post(`/api/workspaces/${ws}/escalations/${esc.body.escalation.id}/acknowledge`).expect(403);

    await setUserRole(me.body.user.id, ws, "vp_engineering");
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const ack = await human
      .post(`/api/workspaces/${ws}/escalations/${esc.body.escalation.id}/acknowledge`)
      .send({ note: "Reviewed" })
      .expect(200);
    assert.equal(ack.body.escalation.state, "resolved");

    const gate = await human.get(`/api/releases/${rel.body.id}/gate`).expect(200);
    assert.equal(gate.body.mode, "strict");
  });

  it("acknowledges escalation with override in one step", async () => {
    const email = `escov_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "EscOv" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await setUserRole(me.body.user.id, ws, "vp_engineering");
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);

    const rel = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "esc-override-v1", release_type: "model_update" })
      .expect(201);

    const keyRes = await human.post(`/api/workspaces/${ws}/api-keys`).send({ name: "esc-ov-agent" }).expect(201);
    const agent = request(app);
    const esc = await agent
      .post(`/api/releases/${rel.body.id}/escalate`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({ reason: "Accuracy blocked after reruns", blocking_signals: ["accuracy"] })
      .expect(202);

    const out = await human
      .post(`/api/workspaces/${ws}/escalations/${esc.body.escalation.id}/acknowledge-and-override`)
      .send({
        note: "Ship with monitoring",
        justification: "Accepting accuracy regression for hotfix; rollback plan in place for 24h.",
        metadata: {
          impact_summary: "Limited cohort on new routing path",
          mitigation_plan: "Rollback via feature flag; on-call monitoring",
          follow_up_due_date: "2026-12-31"
        }
      })
      .expect(200);

    assert.equal(out.body.escalation.state, "resolved");
    assert.equal(out.body.override.status, "CERTIFIED_WITH_OVERRIDE");

    const release = await queryOne("SELECT status FROM releases WHERE id = ?", [rel.body.id]);
    assert.equal(release.status, "CERTIFIED_WITH_OVERRIDE");

    const audit = await queryOne(
      "SELECT event_type FROM audit_events WHERE release_id = ? AND event_type = ? ORDER BY id DESC LIMIT 1",
      [rel.body.id, "ESCALATION_ACKNOWLEDGED_WITH_OVERRIDE"]
    );
    assert.ok(audit);
  });

  it("gate uses workspace default mode when query param omitted", async () => {
    const email = `gatepol_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "GatePol" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await human.post(`/api/workspaces/${ws}/policies`).send({ gate_mode: "strict" }).expect(200);
    const rel = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "gate-pol-v1", release_type: "model_update" })
      .expect(201);

    const gate = await human.get(`/api/releases/${rel.body.id}/gate`).expect(200);
    assert.equal(gate.body.mode, "strict");
  });
});

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

    await agent
      .post(`/api/workspaces/${ws}/api-keys`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .send({ name: "blocked" })
      .expect(403);

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
    assert.ok(["CERTIFIED", "UNCERTIFIED", "COLLECTING"].includes(ingest.body.status));

    const gate = await agent
      .get(`/api/releases/${rel.body.id}/gate`)
      .set("Authorization", `Bearer ${keyRes.body.api_key}`)
      .expect(200);
    assert.equal(typeof gate.body.can_merge, "boolean");
    assert.ok(gate.body.gate);
    assert.ok(["IMPROVING", "STABLE", "DEGRADING", "UNKNOWN"].includes(gate.body.gate.trajectory));
    assert.equal(typeof gate.body.gate.exit_code, "number");
    assert.ok(["merge", "collecting", "self_heal", "escalate"].includes(gate.body.action));

    const esc =
      ingest.body.status === "CERTIFIED" || ingest.body.status === "CERTIFIED_WITH_OVERRIDE"
        ? null
        : await agent
            .post(`/api/releases/${rel.body.id}/escalate`)
            .set("Authorization", `Bearer ${keyRes.body.api_key}`)
            .send({ reason: "Cannot improve accuracy after 2 attempts" })
            .expect(202);
    if (esc) {
      assert.equal(esc.body.escalation.state, "pending_human_review");
      assert.ok(String(esc.body.escalation.id || "").startsWith("esc_"));
    }
  });

  it("validateOutboundWebhookUrl blocks private callback URLs", async () => {
    const { validateOutboundWebhookUrl } = require("../src/lib/outboundUrl");
    await assert.rejects(() => validateOutboundWebhookUrl("http://127.0.0.1/callback"), /private|not allowed/i);
    await assert.doesNotReject(() => validateOutboundWebhookUrl("https://93.184.216.34/verdikt"));
  });
});

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

describe("Workspace signal definitions", () => {
  const app = createApp();

  it("lists catalog, adopts library signal, creates custom signal, deletes", async () => {
    const email = `sigdef_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "SigDef" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const catalog = await agent.get(`/api/workspaces/${ws}/signal-definitions`).expect(200);
    assert.ok(Array.isArray(catalog.body.definitions));
    assert.equal(catalog.body.definitions.length, 0);
    assert.ok(Array.isArray(catalog.body.library));
    assert.ok(catalog.body.library.length >= 5);
    assert.ok(Array.isArray(catalog.body.connectors));
    assert.ok(catalog.body.connectors.some((c) => c.source_id === "zizkadb"));

    const adopt = await agent
      .post(`/api/workspaces/${ws}/signal-definitions/adopt`)
      .send({ signal_id: "smoke", required_for_certification: false })
      .expect(200);
    assert.ok(adopt.body.definitions.some((d) => d.signal_id === "smoke"));

    const custom = await agent
      .post(`/api/workspaces/${ws}/signal-definitions`)
      .send({
        signal_id: "behavioural_drift",
        display_name: "Behavioural Drift",
        direction: "max",
        unit: "score",
        source_id: "zizkadb",
        threshold: { max: 0.15 },
        required_for_certification: true
      })
      .expect(201);
    assert.equal(custom.body.definition.signal_id, "behavioural_drift");
    assert.equal(custom.body.thresholds.behavioural_drift.max, 0.15);
    assert.equal(custom.body.thresholds.behavioural_drift.required_for_certification, true);

    await agent.delete(`/api/workspaces/${ws}/signal-definitions/smoke`).expect(200);
    const afterDelete = await agent.get(`/api/workspaces/${ws}/signal-definitions`).expect(200);
    assert.ok(!afterDelete.body.definitions.some((d) => d.signal_id === "smoke"));
    assert.ok(!afterDelete.body.thresholds.smoke);
    assert.ok(afterDelete.body.library.some((e) => e.signal_id === "smoke"));
  });

  it("removes adopted library signal back to catalog", async () => {
    const email = `sigrem_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "SigRem" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .post(`/api/workspaces/${ws}/signal-definitions/adopt`)
      .send({ signal_id: "accuracy", required_for_certification: true })
      .expect(200);

    await agent.delete(`/api/workspaces/${ws}/signal-definitions/accuracy`).expect(200);
    const catalog = await agent.get(`/api/workspaces/${ws}/signal-definitions`).expect(200);
    assert.ok(!catalog.body.definitions.some((d) => d.signal_id === "accuracy"));
    assert.ok(catalog.body.library.some((e) => e.signal_id === "accuracy"));
    assert.ok(!catalog.body.thresholds.accuracy);
  });

  it("re-adopting a library signal restores prior threshold tuning", async () => {
    const email = `sigreadopt_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "SigRe" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await agent
      .post(`/api/workspaces/${ws}/signal-definitions/adopt`)
      .send({ signal_id: "accuracy", required_for_certification: true })
      .expect(200);

    await agent
      .post(`/api/workspaces/${ws}/thresholds`)
      .send({ thresholds: { accuracy: { min: 90, max: null, required_for_certification: true } } })
      .expect(200);

    await agent.delete(`/api/workspaces/${ws}/signal-definitions/accuracy`).expect(200);

    const readopt = await agent
      .post(`/api/workspaces/${ws}/signal-definitions/adopt`)
      .send({ signal_id: "accuracy" })
      .expect(200);
    assert.equal(readopt.body.thresholds.accuracy.min, 90);
    assert.equal(readopt.body.thresholds.accuracy.required_for_certification, true);
  });
});

// ─── calibration threshold suggestions (prod alignment → Thresholds inbox) ───

describe("calibration threshold suggestions", () => {
  const app = createApp();

  it("OVER_BLOCK alignment appears in threshold-suggestions and apply updates thresholds", async () => {
    const email = `cal_apply_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Cal Apply" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);

    await run(
      "UPDATE thresholds SET min_value = ? WHERE workspace_id = ? AND signal_id = ?",
      [90, ws, "accuracy"]
    );

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "cal-overblock-v1", release_type: "model_update" })
      .expect(201);
    const releaseId = created.body.id;
    const ts = nowIso();

    const overBlockJson = JSON.stringify([
      {
        signal_id: "accuracy",
        direction: "lower_min",
        current_threshold: 90,
        suggested_threshold: 85.5,
        pre_release_value: 88,
        gap: 2,
        rationale: "Production was healthy — accuracy was 88, only 2 below min 90."
      }
    ]);

    await run(
      `INSERT INTO outcome_alignments
        (release_id, workspace_id, recommended_verdict, actual_outcome, alignment,
         signal_deltas_json, outcome_criteria_json, over_block_suggestions_json, computed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        releaseId,
        ws,
        "UNCERTIFIED",
        "HEALTHY",
        "OVER_BLOCK",
        "{}",
        "[]",
        overBlockJson,
        ts,
        ts
      ]
    );

    const suggestions = await agent.get(`/api/workspaces/${ws}/threshold-suggestions`).expect(200);
    const cal = (suggestions.body.suggestions || []).find(
      (s) => s.source === "prod_alignment" && s.signal_id === "accuracy" && s.direction === "min"
    );
    assert.ok(cal, "prod alignment suggestion should appear in threshold-suggestions");
    assert.equal(cal.alignment, "OVER_BLOCK");
    assert.equal(cal.suggested, 85.5);

    await agent.post(`/api/workspaces/${ws}/threshold-suggestions/${encodeURIComponent(cal.id)}/apply`).expect(200);

    const thresh = await agent.get(`/api/workspaces/${ws}/thresholds`).expect(200);
    assert.equal(thresh.body.thresholds.accuracy.min, 85.5);
  });
});

// ─── postVerdictEffects + webhook delivery ───────────────────────────────────

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

describe("webhook delivery unit", () => {
  it("buildVerdictPayload includes certification and cert_signature fields", () => {
    const { buildVerdictPayload } = require("../src/services/outboundWebhook");
    const release = {
      id: "r_webhook_unit",
      workspace_id: "ws_webhook",
      version: "v2.0.0",
      release_type: "model_update",
      environment: "prod",
      status: "CERTIFIED",
      verdict_issued_at: nowIso()
    };
    const sigRow = { payload_hash: "abc123", signature: "sig456", signed_at: nowIso(), algorithm: "HMAC-SHA256-v1" };
    const cert = { summary: "All passed.", risk_level: "low", confidence: 0.95 };
    const payload = buildVerdictPayload(release, "CERTIFIED", null, sigRow, [], cert);
    assert.equal(payload.event, "CERTIFIED");
    assert.ok(payload.cert_signature?.payload_hash, "cert_signature should be present");
    assert.equal(payload.cert_signature.signature, "sig456");
    assert.ok(payload.certification?.summary, "certification context should be present");
    assert.equal(payload.certification.confidence, 0.95);
  });

  it("buildVerdictPayload handles missing sigRow and certification gracefully", () => {
    const { buildVerdictPayload } = require("../src/services/outboundWebhook");
    const release = {
      id: "r_webhook_unit2",
      workspace_id: "ws_webhook",
      version: "v2.0.1",
      release_type: "model_update",
      status: "UNCERTIFIED",
      verdict_issued_at: nowIso()
    };
    const payload = buildVerdictPayload(release, "UNCERTIFIED", null, null, [], null);
    assert.strictEqual(payload.cert_signature, null, "cert_signature should be null when no sigRow");
    assert.strictEqual(payload.certification, null, "certification should be null for UNCERTIFIED");
  });
});

const skipLiveGemini = process.env.GEMINI_LIVE_TEST !== "1" || !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === GEMINI_STUB;

(skipLiveGemini ? describe.skip : describe)("Gemini live API (set GEMINI_API_KEY to a real key to run)", () => {
  it(
    "real Gemini returns non-empty text",
    { timeout: 15_000 },
    async () => {
      const prev = global.fetch;
      global.fetch = fetch;
      try {
        const text = await callIntelligenceModel(
          'Return JSON only: {"summary":"live ping ok","recommended_actions":["verify in CI"]}',
          { maxTokens: 200 }
        );
        assert.ok(text.length > 10);
        assert.ok(text.includes("summary") || text.includes("live"));
      } finally {
        global.fetch = prev;
      }
    }
  );
});
