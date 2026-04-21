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
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";
/** Enable assistive path for llmAssist tests (mocked fetch — no real API calls). */
process.env.ENABLE_ASSISTIVE_LLM = "1";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "unit-test-stub-gemini-key-not-for-production-use";

const { describe, it, after, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { initDatabase, queryOne, run } = require("../src/database");
const { createApp } = require("../src/app");
const {
  computeVerdict,
  ensureWorkspaceSeeded,
  getThresholdMap,
  assessOverrideJustification
} = require("../src/services/domain");
const { analyzeReleaseDeltas } = require("../src/services/delta");
const { nowIso } = require("../src/lib/time");
const { maybeEnrichVerdictIntelligence } = require("../src/services/llmAssist");
const { callIntelligenceModel } = require("../src/services/aiClient");

before(async () => {
  await initDatabase();
});

describe("API integration", () => {
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

  it("viewer role cannot mutate thresholds (RBAC)", async () => {
    const email = `view_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Viewer" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const uid = me.body.user.id;
    await run("UPDATE users SET role = ? WHERE id = ?", ["viewer", uid]);

    await agent
      .post(`/api/workspaces/${ws}/thresholds`)
      .send({ thresholds: { accuracy: { min: 80, max: 100 } } })
      .expect(403);
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
    await ensureWorkspaceSeeded(ws);
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
    await ensureWorkspaceSeeded(ws);
    const v = await computeVerdict(ws, "rel_unused", { accuracy: 70 }, null);
    assert.equal(v.status, "UNCERTIFIED");
    const acc = v.failed_signals.find((f) => f.signal_id === "accuracy");
    assert.ok(acc);
    assert.equal(acc.failure_kind, "absolute_threshold");
  });
});

describe("analyzeReleaseDeltas regression (unit)", () => {
  const ws = "ws_delta_unit";

  it("flags regression when drop exceeds allowed delta", async () => {
    await ensureWorkspaceSeeded(ws);
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

const GEMINI_STUB = "unit-test-stub-gemini-key-not-for-production-use";
const skipLiveGemini = !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === GEMINI_STUB;

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
