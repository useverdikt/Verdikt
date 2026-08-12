"use strict";

/**
 * Split from former backend.test.js — domain suite.
 */

require("./helpers/backendFixtures");

const crypto = require("crypto");
const { describe, it, after, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { queryOne, run, transaction } = require("../src/database");
const {
  writeAudit,
  ensureWorkspaceSeeded,
  GEMINI_STUB,
  createApp,
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

const skipLiveGemini =
  process.env.GEMINI_LIVE_TEST !== "1" ||
  !process.env.GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY === GEMINI_STUB;

describe("release intelligence recommendation vs user decision (unit)", () => {
  it("keeps recommendation when user records intelligence decision", async () => {
    const ws = `ws_intel_${crypto.randomBytes(3).toString("hex")}`;
    await ensureWorkspaceSeeded(ws);
    const releaseId = `rel_intel_${crypto.randomBytes(3).toString("hex")}`;
    const now = nowIso();
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at, verdict_issued_at, collection_deadline)
       VALUES ($1, $2, 'v1', 'model_update', 'pre-prod', 'CERTIFIED', $3, $4, $5, $6)`,
      [releaseId, ws, now, now, now, now]
    );
    await run(`INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'accuracy', 92, 't', $2)`, [
      releaseId,
      now
    ]);
    await writeAudit({
      workspaceId: ws,
      releaseId,
      eventType: "SIGNALS_INGESTED",
      actorType: "SYSTEM",
      actorName: "test",
      details: { failed_signals: [], missing_required_signals: [] }
    });

    const release = await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
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

  it("preserves independent intelligence patches that commit concurrently", async () => {
    const ws = `ws_intel_concurrent_${crypto.randomBytes(3).toString("hex")}`;
    const releaseId = `rel_intel_concurrent_${crypto.randomBytes(3).toString("hex")}`;
    const now = nowIso();
    await ensureWorkspaceSeeded(ws);
    await run(
      `INSERT INTO releases
         (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
       VALUES ($1, $2, 'v1', 'model_update', 'pre-prod', 'COLLECTING', $3, $3)`,
      [releaseId, ws, now]
    );

    let arrivals = 0;
    const waiters = [];
    const waitForBothWrites = async () => {
      arrivals += 1;
      if (arrivals === 2) {
        for (const resolve of waiters.splice(0)) resolve();
        return;
      }
      await new Promise((resolve) => waiters.push(resolve));
    };
    const coordinatedPatch = (patch) =>
      transaction((tx) =>
        upsertReleaseIntelligence(releaseId, ws, patch, {
          queryOne: tx.queryOne.bind(tx),
          run: async (...args) => {
            await waitForBothWrites();
            return tx.run(...args);
          }
        })
      );

    const verdict = { status: "UNCERTIFIED", summary: "concurrent verdict" };
    const recommendation = {
      recommended_verdict: "UNCERTIFIED",
      confidence_score: 73,
      summary: "concurrent recommendation"
    };
    await Promise.all([
      coordinatedPatch({ verdict }),
      coordinatedPatch({ recommendation })
    ]);

    const intelligence = await getReleaseIntelligence(releaseId);
    assert.deepEqual(intelligence.verdict, verdict);
    assert.deepEqual(intelligence.recommendation, recommendation);
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
       VALUES ($1, $2, 'v0', 'model_update', 'env', 'CERTIFIED', $3, $4)`,
      [baseId, ws, oldIso, oldIso]
    );

    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
       VALUES ($1, $2, 'v1', 'model_update', 'env', 'UNCERTIFIED', $3, $4)`,
      [curId, ws, newIso, newIso]
    );

    await run(
      `INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'accuracy', 90, 't', $2)`,
      [baseId, oldIso]
    );
    await run(
      `INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'accuracy', 78, 't', $2)`,
      [curId, newIso]
    );

    const releaseRow = await queryOne("SELECT * FROM releases WHERE id = $1", [curId]);
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
    const controller = new AbortController();
    global.fetch = async (_url, options) => {
      assert.equal(options.signal, controller.signal);
      return {
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
      };
    };
    try {
      const text = await callIntelligenceModel('{"prompt":"x"}', {
        maxTokens: 200,
        signal: controller.signal
      });
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

