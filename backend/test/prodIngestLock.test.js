"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";

const crypto = require("crypto");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { initDatabase, queryOne, run } = require("../src/database");
const { createApp } = require("../src/app");
const { ensureWorkspaceSeeded, evaluateReleaseAfterSignalIngest } = require("../src/services/domain");
const {
  releaseVerdictLockedAgainstIngest,
  releaseIngestLockError
} = require("../src/services/verdictEngine");
const { nowIso } = require("../src/lib/time");

let app;

before(async () => {
  await initDatabase();
  app = createApp();
});

describe("prod uncertified ingest lock", () => {
  it("releaseVerdictLockedAgainstIngest blocks UNCERTIFIED in prod only", () => {
    assert.equal(
      releaseVerdictLockedAgainstIngest({ status: "UNCERTIFIED", environment: "prod", verdict_issued_at: nowIso() }),
      true
    );
    assert.equal(
      releaseVerdictLockedAgainstIngest({ status: "UNCERTIFIED", environment: "pre-prod", verdict_issued_at: nowIso() }),
      false
    );
    assert.equal(
      releaseVerdictLockedAgainstIngest({ status: "COLLECTING", environment: "prod" }),
      false
    );
    assert.equal(
      releaseVerdictLockedAgainstIngest({ status: "CERTIFIED", environment: "pre-prod", verdict_issued_at: nowIso() }),
      true
    );
  });

  it("releaseIngestLockError distinguishes prod uncertified from certified lock", () => {
    assert.match(
      releaseIngestLockError({ status: "UNCERTIFIED", environment: "prod" }),
      /live in production/i
    );
    assert.match(
      releaseIngestLockError({ status: "CERTIFIED", environment: "pre-prod" }),
      /locked after certification/i
    );
  });

  it("POST signals returns 409 for UNCERTIFIED prod release", async () => {
    const email = `prodlock_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "PL" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "prod-lock-v1", release_type: "model_update" })
      .expect(201);

    const now = nowIso();
    await run(
      `UPDATE releases SET status = $1, environment = $2, verdict_issued_at = $3, updated_at = $4 WHERE id = $5`,
      ["UNCERTIFIED", "prod", now, now, created.body.id]
    );

    const res = await agent
      .post(`/api/releases/${created.body.id}/signals`)
      .send({ source: "test", signals: { accuracy: 92 } })
      .expect(409);

    assert.match(res.body.error, /live in production/i);
    assert.equal(res.body.status, "UNCERTIFIED");
    assert.equal(res.body.environment, "prod");

    const count = await queryOne("SELECT COUNT(*) AS c FROM signals WHERE release_id = $1", [created.body.id]);
    assert.equal(Number(count.c), 0);
  });

  it("pre-prod UNCERTIFIED re-evaluates on new signals and can self-heal to CERTIFIED", async () => {
    const ws = `ws_selfheal_${crypto.randomBytes(3).toString("hex")}`;
    await ensureWorkspaceSeeded(ws);
    const releaseId = `rel_sh_${crypto.randomBytes(3).toString("hex")}`;
    const now = nowIso();
    const deadline = new Date(Date.now() + 60_000).toISOString();

    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at, verdict_issued_at, collection_deadline)
       VALUES ($1, $2, 'v-sh', 'model_update', 'pre-prod', 'UNCERTIFIED', $3, $4, $5, $6)`,
      [releaseId, ws, now, now, now, deadline]
    );
    await run(`INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'accuracy', 70, 't', $2)`, [
      releaseId,
      now
    ]);

    const release = await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
    await run(`INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'accuracy', 95, 't', $2)`, [
      releaseId,
      now
    ]);
    await run(`INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'safety', 96, 't', $2)`, [
      releaseId,
      now
    ]);
    await run(`INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'smoke', 100, 't', $2)`, [
      releaseId,
      now
    ]);
    await run(
      `INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'e2e_regression', 100, 't', $2)`,
      [releaseId, now]
    );
    await run(
      `INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'manual_qa_pct', 99, 't', $2)`,
      [releaseId, now]
    );

    const out = await evaluateReleaseAfterSignalIngest(release, releaseId, "test", 5);
    assert.equal(out.status, "CERTIFIED");

    const row = await queryOne("SELECT status FROM releases WHERE id = $1", [releaseId]);
    assert.equal(row.status, "CERTIFIED");
  });
});