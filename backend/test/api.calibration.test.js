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

describe("calibration threshold suggestions", () => {
  const app = createApp();

  it("CAUTIOUS alignment appears in threshold-suggestions and apply updates thresholds", async () => {
    const email = `cal_apply_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Cal Apply" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);

    await run(
      "UPDATE thresholds SET min_value = $1 WHERE workspace_id = $2 AND signal_id = $3",
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        releaseId,
        ws,
        "UNCERTIFIED",
        "HEALTHY",
        "CAUTIOUS",
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
    assert.equal(cal.alignment, "CAUTIOUS");
    assert.equal(cal.suggested, 85.5);

    await agent.post(`/api/workspaces/${ws}/threshold-suggestions/${encodeURIComponent(cal.id)}/apply`).expect(200);

    const thresh = await agent.get(`/api/workspaces/${ws}/thresholds`).expect(200);
    assert.equal(thresh.body.thresholds.accuracy.min, 85.5);
  });

  it("calibration-suggestions endpoint and check_gate include prod calibration context", async () => {
    const email = `cal_gate_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Cal Gate" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "cal-gate-v1", release_type: "model_update" })
      .expect(201);
    const releaseId = created.body.id;
    const ts = nowIso();

    await run(
      `INSERT INTO outcome_alignments
        (release_id, workspace_id, recommended_verdict, actual_outcome, alignment,
         signal_deltas_json, outcome_criteria_json, over_block_suggestions_json, computed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        releaseId,
        ws,
        "UNCERTIFIED",
        "HEALTHY",
        "CAUTIOUS",
        "{}",
        "[]",
        JSON.stringify([
          {
            signal_id: "accuracy",
            direction: "lower_min",
            current_threshold: 90,
            suggested_threshold: 85.5,
            rationale: "Prod healthy after block."
          }
        ]),
        ts,
        ts
      ]
    );

    const calApi = await agent.get(`/api/workspaces/${ws}/calibration-suggestions`).expect(200);
    assert.equal(calApi.body.mode, "suggest_only");
    assert.ok((calApi.body.suggestions || []).length >= 1);
    assert.ok(calApi.body.context);
    assert.ok(calApi.body.context.pending_suggestions_count >= 1);
    assert.equal(calApi.body.context.mode, "suggest_only");

    const gate = await agent.get(`/api/releases/${releaseId}/gate`).expect(200);
    assert.ok(gate.body.calibration, "gate should include calibration context when alignments exist");
    assert.ok(gate.body.calibration.summary);
    assert.ok(gate.body.calibration.pending_suggestions_count >= 1);
    assert.equal(gate.body.calibration.mode, "suggest_only");
  });

  it("auto_apply policy applies CAUTIOUS prod suggestions via calibrationAutoApply", async () => {
    const email = `cal_auto_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Cal Auto" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);
    await run("UPDATE workspace_policies SET calibration_mode = 'auto_apply' WHERE workspace_id = $1", [ws]);
    await run("UPDATE thresholds SET min_value = $1 WHERE workspace_id = $2 AND signal_id = $3", [90, ws, "accuracy"]);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "cal-auto-v1", release_type: "model_update" })
      .expect(201);
    const releaseId = created.body.id;
    const ts = nowIso();

    await run(
      `INSERT INTO outcome_alignments
        (release_id, workspace_id, recommended_verdict, actual_outcome, alignment,
         signal_deltas_json, outcome_criteria_json, over_block_suggestions_json, computed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        releaseId,
        ws,
        "UNCERTIFIED",
        "HEALTHY",
        "CAUTIOUS",
        "{}",
        "[]",
        JSON.stringify([
          {
            signal_id: "accuracy",
            direction: "lower_min",
            current_threshold: 90,
            suggested_threshold: 85.5,
            rationale: "Prod healthy after block."
          }
        ]),
        ts,
        ts
      ]
    );

    const { maybeAutoApplyCalibrationSuggestions } = require("../src/services/calibrationAutoApply");
    const result = await maybeAutoApplyCalibrationSuggestions(ws, releaseId, "CAUTIOUS");
    assert.ok(result.applied.length >= 1, "auto_apply should apply prod suggestion");

    const thresh = await agent.get(`/api/workspaces/${ws}/thresholds`).expect(200);
    assert.equal(thresh.body.thresholds.accuracy.min, 85.5);
  });

  it("policies default calibration_mode to suggest_only", async () => {
    const email = `cal_pol_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Cal Pol" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    const policies = await agent.get(`/api/workspaces/${ws}/policies`).expect(200);
    assert.equal(policies.body.policies.calibration_mode, "suggest_only");
  });

  it("dismissed prod calibration suggestion stays suppressed on new alignment", async () => {
    const email = `cal_dismiss_${crypto.randomBytes(4).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "Cal Dismiss" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;
    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);
    await run("UPDATE thresholds SET min_value = $1 WHERE workspace_id = $2 AND signal_id = $3", [90, ws, "accuracy"]);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "cal-dismiss-v1", release_type: "model_update" })
      .expect(201);
    const releaseId = created.body.id;
    const ts = nowIso();

    const insertAlignment = async (version) => {
      const rel = version === "cal-dismiss-v1"
        ? releaseId
        : (
            await agent
              .post(`/api/workspaces/${ws}/releases`)
              .send({ version, release_type: "model_update" })
              .expect(201)
          ).body.id;
      await run(
        `INSERT INTO outcome_alignments
          (release_id, workspace_id, recommended_verdict, actual_outcome, alignment,
           signal_deltas_json, outcome_criteria_json, over_block_suggestions_json, computed_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(release_id) DO UPDATE SET alignment = excluded.alignment, over_block_suggestions_json = excluded.over_block_suggestions_json`,
        [
          rel,
          ws,
          "UNCERTIFIED",
          "HEALTHY",
          "CAUTIOUS",
          "{}",
          "[]",
          JSON.stringify([
            {
              signal_id: "accuracy",
              direction: "lower_min",
              current_threshold: 90,
              suggested_threshold: 85.5,
              rationale: "Prod healthy after block."
            }
          ]),
          ts,
          ts
        ]
      );
      return rel;
    };

    await insertAlignment("cal-dismiss-v1");
    const first = await agent.get(`/api/workspaces/${ws}/threshold-suggestions`).expect(200);
    const sug = (first.body.suggestions || []).find((s) => s.signal_id === "accuracy" && s.source === "prod_alignment");
    assert.ok(sug, "initial prod suggestion should exist");
    await agent.post(`/api/workspaces/${ws}/threshold-suggestions/${encodeURIComponent(sug.id)}/dismiss`).expect(200);

    await insertAlignment("cal-dismiss-v2");
    const second = await agent.get(`/api/workspaces/${ws}/threshold-suggestions`).expect(200);
    const again = (second.body.suggestions || []).find(
      (s) => s.signal_id === "accuracy" && s.source === "prod_alignment"
    );
    assert.equal(again, undefined, "dismissed accuracy prod suggestion should not reappear on new alignment");
  });
});

// ─── postVerdictEffects + webhook delivery ───────────────────────────────────

