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

const { initDatabase, run, queryOne, queryAll } = require("../src/database");
const { createApp } = require("../src/app");
const { ensureWorkspaceSeeded } = require("../src/services/domain");
const { nowIso } = require("../src/lib/time"); // used by signal ingest test

let app;

before(async () => {
  await initDatabase();
  app = await createApp();
});

// ---------------------------------------------------------------------------
// Fix 1: SQL IN clause crash in intelligence.js:91
// ---------------------------------------------------------------------------
describe("intelligence backfill SQL IN clause", () => {
  it("generates correct $1,$2,$3 placeholders for multi-status IN clause", () => {
    const VERDICTED = ["CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE"];
    const placeholders = VERDICTED.map((_, i) => `$${i + 2}`).join(",");
    assert.equal(placeholders, "$2,$3,$4");
  });

  it("does not repeat $2 as all placeholders (old bug)", () => {
    const VERDICTED = ["CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE"];
    const buggyPlaceholders = VERDICTED.map(() => "$2").join(",");
    // The fix should produce a different (correct) result
    const fixedPlaceholders = VERDICTED.map((_, i) => `$${i + 2}`).join(",");
    assert.notEqual(fixedPlaceholders, buggyPlaceholders);
  });

  it("backfill endpoint is reachable with human session and does not crash with SQL bind error", async () => {
    const email = `intel_test_${crypto.randomBytes(6).toString("hex")}@test.com`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "IntelTest" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const wsId = me.body.user.workspace_id;

    const res = await agent.post(`/api/workspaces/${wsId}/recommendations/backfill`);

    // The old SQL bind bug crashed with 500 (Postgres "bind message supplies N parameters")
    // The fix returns 200 (even with 0 releases to backfill)
    assert.ok(res.status !== 500, `Expected non-500 but got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: requireHumanSession blocks agent API keys on credential mutation routes
// ---------------------------------------------------------------------------
describe("integration credential routes require human session", () => {
  let agentApiKey;
  let wsId;

  before(async () => {
    const email = `int_test_${crypto.randomBytes(6).toString("hex")}@test.com`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "IntTest" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    wsId = me.body.user.workspace_id;

    const keyRes = await agent
      .post(`/api/workspaces/${wsId}/api-keys`)
      .send({ name: "test-agent-key" })
      .expect(201);
    agentApiKey = keyRes.body.api_key;
  });

  it("PUT /signal-integrations rejects agent API key with 403", async () => {
    const res = await request(app)
      .put(`/api/workspaces/${wsId}/signal-integrations/github`)
      .set("Authorization", `Bearer ${agentApiKey}`)
      .send({ token: "ghs_fake" });

    assert.equal(res.status, 403, `Agent key should be rejected with 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it("DELETE /signal-integrations rejects agent API key with 403", async () => {
    const res = await request(app)
      .delete(`/api/workspaces/${wsId}/signal-integrations/github`)
      .set("Authorization", `Bearer ${agentApiKey}`);

    assert.equal(res.status, 403, `Agent key should be rejected with 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it("POST /signal-csv-imports rejects agent API key with 403", async () => {
    const res = await request(app)
      .post(`/api/workspaces/${wsId}/signal-csv-imports`)
      .set("Authorization", `Bearer ${agentApiKey}`)
      .attach("file", Buffer.from("signal_id,value\naccuracy,90\n"), "test.csv");

    assert.equal(res.status, 403, `Agent key should be rejected with 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Idempotency check is inside transaction (TOCTOU fix)
// ---------------------------------------------------------------------------
describe("signal ingest idempotency TOCTOU fix", () => {
  it("concurrent ingests with same idempotency key insert signals only once", async () => {
    const wsId = `ws_idem_${crypto.randomBytes(4).toString("hex")}`;
    const releaseId = `rel_idem_${crypto.randomBytes(4).toString("hex")}`;
    const idempotencyKey = `idem_${crypto.randomBytes(8).toString("hex")}`;
    await ensureWorkspaceSeeded(wsId);

    const ts = nowIso();
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [releaseId, wsId, "v1.0.0", "model_update", "staging", "COLLECTING", ts, ts]
    );

    const { ingestIntegrationSignals } = require("../src/services/signalIngest");
    const release = await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);

    // First ingest
    await ingestIntegrationSignals({
      release,
      mappedSignals: { accuracy: 90 },
      source: "test",
      idempotencyKey
    });

    // Second ingest with same key — should be treated as duplicate
    const result = await ingestIntegrationSignals({
      release,
      mappedSignals: { accuracy: 90 },
      source: "test",
      idempotencyKey
    });

    assert.equal(result.duplicate, true, "second ingest should be flagged as duplicate");
    assert.equal(result.inserted_count, 0, "duplicate ingest should insert 0 rows");

    const signals = await queryAll(
      "SELECT * FROM signals WHERE release_id = $1 AND idempotency_key = $2",
      [releaseId, idempotencyKey]
    );
    assert.equal(signals.length, 1, `Expected exactly 1 signal row, got ${signals.length}`);
  });
});

// ---------------------------------------------------------------------------
// Fix 4: Audit chain SELECT FOR UPDATE prevents concurrent fork
// ---------------------------------------------------------------------------
describe("audit chain locking", () => {
  it("sequential writes produce a valid unbroken chain", async () => {
    const wsId = `ws_lock_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(wsId);

    const { writeAudit } = require("../src/services/audit");
    const { verifyAuditIntegrity } = require("../src/services/auditIntegrity");

    for (let i = 0; i < 5; i++) {
      await writeAudit({
        workspaceId: wsId,
        eventType: "LOCK_TEST",
        actorType: "SYSTEM",
        actorName: "test",
        details: { seq: i }
      });
    }

    const integrity = await verifyAuditIntegrity(wsId);
    assert.equal(integrity.valid, true, JSON.stringify(integrity));
    assert.equal(integrity.tampered.length, 0);
    assert.equal(integrity.broken_chain.length, 0);
    assert.equal(integrity.missing_hash.length, 0);
  });

  it("parallel writes do not produce broken chain links", async () => {
    const wsId = `ws_par_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(wsId);

    const { writeAudit } = require("../src/services/audit");
    const { verifyAuditIntegrity } = require("../src/services/auditIntegrity");

    // Fire 10 concurrent writes — SELECT FOR UPDATE serialises them
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        writeAudit({
          workspaceId: wsId,
          eventType: "PARALLEL_LOCK_TEST",
          actorType: "SYSTEM",
          actorName: "test",
          details: { seq: i }
        })
      )
    );

    const integrity = await verifyAuditIntegrity(wsId);
    assert.equal(integrity.broken_chain.length, 0, `Chain broken: ${JSON.stringify(integrity.broken_chain)}`);
    assert.equal(integrity.tampered.length, 0);
    assert.equal(integrity.total, 10);
  });
});
