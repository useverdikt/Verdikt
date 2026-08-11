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
       VALUES ($1, $2, 'v-empty', 'model_update', 'pre-prod', 'COLLECTING', $3, $4, $5)`,
      [releaseId, ws, now, now, new Date(Date.now() - 60_000).toISOString()]
    );
    const release = await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
    const out = await evaluateReleaseAfterSignalIngest(release, releaseId, "test", 0);
    assert.equal(out.status, "UNCERTIFIED");
    assert.ok(out.failed_signals.some((f) => f.failure_kind === "no_ingest"));
    const row = await queryOne("SELECT status FROM releases WHERE id = $1", [releaseId]);
    assert.equal(row.status, "UNCERTIFIED");
    const intelligence = await getReleaseIntelligence(releaseId);
    assert.deepEqual(intelligence.verdict.failed_signals, out.failed_signals);
    assert.deepEqual(
      intelligence.verdict.threshold_failed_signals,
      out.threshold_failed_signals
    );
  });

  it("preserves verdict_issued_at on re-evaluation after UNCERTIFIED", async () => {
    const ws = `ws_verdict_ts_${crypto.randomBytes(3).toString("hex")}`;
    await ensureWorkspaceSeeded(ws);
    const releaseId = `rel_vt_${crypto.randomBytes(3).toString("hex")}`;
    const firstVerdictAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const now = nowIso();
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at, verdict_issued_at, collection_deadline)
       VALUES ($1, $2, 'v-re', 'model_update', 'pre-prod', 'UNCERTIFIED', $3, $4, $5, $6)`,
      [releaseId, ws, now, now, firstVerdictAt, new Date(Date.now() - 60_000).toISOString()]
    );
    await run(`INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'accuracy', 70, 't', $2)`, [
      releaseId,
      now
    ]);
    const release = await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
    await evaluateReleaseAfterSignalIngest(release, releaseId, "test", 1);
    const after = await queryOne("SELECT verdict_issued_at FROM releases WHERE id = $1", [releaseId]);
    assert.equal(after.verdict_issued_at, firstVerdictAt);
  });
});

