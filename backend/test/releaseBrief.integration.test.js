"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";

const crypto = require("crypto");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { initDatabase, queryOne, run } = require("../src/database");
const { createApp } = require("../src/app");
const { ensureWorkspaceSeeded } = require("../src/services/domain");
const sharedPkg = require("../src/lib/sharedPkg");
const { BRIEF_VERSION } = require("../src/services/releaseBrief");

let app;

async function seedDefaultThresholdsForTest(workspaceId) {
  await ensureWorkspaceSeeded(workspaceId);
  const countRow = await queryOne("SELECT COUNT(*) AS c FROM thresholds WHERE workspace_id = $1", [workspaceId]);
  if (Number(countRow?.c || 0) > 0) return;
  const defaults = sharedPkg.getDefaultThresholdSeedRows();
  const defaultRequired = new Set(sharedPkg.defaultRequiredSignalIds || []);
  const insertSql =
    "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification) VALUES ($1, $2, $3, $4, $5)";
  for (const row of defaults) {
    await run(insertSql, [workspaceId, row[0], row[1], row[2], defaultRequired.has(row[0]) ? 1 : 0]);
  }
}

before(async () => {
  await initDatabase();
  app = createApp();
});

describe("GET /api/releases/:releaseId/release-brief", () => {
  it("returns deterministic brief for UNCERTIFIED release with blockers", async () => {
    const email = `brief_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const human = request.agent(app);
    await human.post("/api/auth/register").send({ email, password: "password123", name: "Brief" }).expect(200);
    await human.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await human.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    await seedDefaultThresholdsForTest(ws);

    const created = await human
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "brief-v1", release_type: "model_update" })
      .expect(201);

    await human
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

    const brief = await human.get(`/api/releases/${created.body.id}/release-brief`).expect(200);

    assert.equal(brief.body.brief_version, BRIEF_VERSION);
    assert.equal(brief.body.release_id, created.body.id);
    assert.equal(brief.body.status, "UNCERTIFIED");
    assert.ok(Array.isArray(brief.body.top_blockers));
    assert.ok(brief.body.top_blockers.length >= 1);
    assert.equal(brief.body.suggested_verb, "escalate");
    assert.equal(brief.body.gate_action, "escalate");
    assert.equal(brief.body.verdict.can_merge, false);
    assert.ok(brief.body.hub_links?.intelligence_alignment);
    assert.ok(brief.body.regression_story);
    assert.ok(typeof brief.body.agent_note === "string");

    const audit = await queryOne(
      `SELECT event_type FROM audit_events
       WHERE release_id = $1 AND event_type = 'RELEASE_BRIEF_READ'
       ORDER BY created_at DESC LIMIT 1`,
      [created.body.id]
    );
    assert.ok(audit, "release brief read should write audit event");
  });
});
