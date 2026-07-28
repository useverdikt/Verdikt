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

const { initDatabase, run } = require("../src/database");
const { createApp } = require("../src/app");
const { getThresholdMap } = require("../src/services/domain");
const { getLatestSignalMap } = require("../src/services/verdictEngine");
const certificationSnapshots = require("../src/services/certificationSnapshots");
const {
  backfillMissingCertificationSnapshots,
  processDueCertificationSnapshotRetries
} = require("../src/services/certificationSnapshotRetry");

let app;

before(async () => {
  await initDatabase();
  app = await createApp();
});

async function humanSession() {
  const email = `human_${crypto.randomBytes(4).toString("hex")}@test.local`;
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ email, password: "password123", name: "Human" }).expect(200);
  await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
  const me = await agent.get("/api/auth/me").expect(200);
  return { human: agent, email, workspaceId: me.body.user.workspace_id };
}

async function createAndCertifyRelease(human, workspaceId) {
  const rel = await human
    .post(`/api/workspaces/${workspaceId}/releases`)
    .send({ version: "v1", release_type: "model_update" })
    .expect(201);
  const releaseId = rel.body.id;

  await human.put(`/api/workspaces/${workspaceId}/signal-integrations/braintrust`).send({ apiKey: "bt_test" }).expect(200);

  const thresholdMap = await getThresholdMap(workspaceId);
  const signals = {};
  for (const sid of ["accuracy", "safety", "tone", "hallucination", "relevance"]) {
    const t = thresholdMap[sid];
    signals[sid] = t?.min != null ? Number(t.min) + 1 : 90;
  }
  signals.smoke = 100;
  signals.e2e_regression = 100;
  signals.manual_qa_pct = 100;

  const ingest = await human
    .post(`/api/releases/${releaseId}/signals`)
    .send({ source: "manual", signals })
    .expect(200);
  assert.ok(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"].includes(ingest.body.status), `expected certified, got ${ingest.body.status}`);

  return { releaseId, signals };
}

describe("certified release gate uses frozen snapshot", () => {
  it("allows merge when certification snapshot is present", async () => {
    const { human, workspaceId } = await humanSession();
    const { releaseId } = await createAndCertifyRelease(human, workspaceId);

    const gate = await human.get(`/api/releases/${releaseId}/gate`).expect(200);
    assert.equal(gate.body.can_merge, true);
    assert.equal(gate.body.action, "merge");
    assert.equal(gate.body.snapshot_pending, false);
  });

  it("blocks merge when certification snapshot is missing", async () => {
    const { human, workspaceId } = await humanSession();
    const { releaseId } = await createAndCertifyRelease(human, workspaceId);

    await run("DELETE FROM certification_snapshots WHERE release_id = $1", [releaseId]);

    const gate = await human.get(`/api/releases/${releaseId}/gate`).expect(200);
    assert.equal(gate.body.can_merge, false);
    assert.equal(gate.body.snapshot_pending, true);
    assert.equal(gate.body.action, "recover_certification");
    assert.match(gate.body.gate.reason || "", /snapshot/i);
  });

  it("restores merge after the snapshot is re-persisted", async () => {
    const { human, workspaceId } = await humanSession();
    const { releaseId } = await createAndCertifyRelease(human, workspaceId);

    await run("DELETE FROM certification_snapshots WHERE release_id = $1", [releaseId]);
    const missing = await human.get(`/api/releases/${releaseId}/gate`).expect(200);
    assert.equal(missing.body.snapshot_pending, true);

    const [thresholdMap, latest] = await Promise.all([
      getThresholdMap(workspaceId),
      getLatestSignalMap(releaseId)
    ]);
    await certificationSnapshots.persistCertificationSnapshot({
      releaseId,
      workspaceId,
      thresholdMap,
      signalMap: latest,
      status: "CERTIFIED"
    });

    const gate = await human.get(`/api/releases/${releaseId}/gate`).expect(200);
    assert.equal(gate.body.can_merge, true, JSON.stringify(gate.body));
    assert.equal(gate.body.action, "merge");
    assert.equal(gate.body.snapshot_pending, false);
  });

  it("still allows merge after live thresholds are tightened post-certification", async () => {
    const { human, workspaceId } = await humanSession();
    const { releaseId } = await createAndCertifyRelease(human, workspaceId);

    // Tighten live thresholds so the same signals would fail today.
    await human
      .post(`/api/workspaces/${workspaceId}/thresholds`)
      .send({ thresholds: { accuracy: { min: 99 } } })
      .expect(200);

    const gate = await human.get(`/api/releases/${releaseId}/gate`).expect(200);
    assert.equal(gate.body.can_merge, true, "certified release should merge using frozen snapshot, not live thresholds");
    assert.equal(gate.body.action, "merge");
  });

  it("backfills missing snapshots for legacy certified releases and restores merge", async () => {
    const { human, workspaceId } = await humanSession();
    const { releaseId } = await createAndCertifyRelease(human, workspaceId);

    await run("DELETE FROM certification_snapshots WHERE release_id = $1", [releaseId]);
    const before = await human.get(`/api/releases/${releaseId}/gate`).expect(200);
    assert.equal(before.body.action, "recover_certification");
    assert.equal(before.body.snapshot_pending, true);

    // Target the specific release so the test is not affected by leftover rows in the test DB.
    const backfill = await backfillMissingCertificationSnapshots({ releaseId, limit: 10 });
    assert.equal(backfill.processed, 1, "backfill should discover exactly this missing snapshot");
    await processDueCertificationSnapshotRetries();

    const after = await human.get(`/api/releases/${releaseId}/gate`).expect(200);
    assert.equal(after.body.can_merge, true, JSON.stringify(after.body));
    assert.equal(after.body.action, "merge");
    assert.equal(after.body.snapshot_pending, false);
  });
});
