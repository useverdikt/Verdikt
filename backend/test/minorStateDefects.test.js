"use strict";

/**
 * Issue J (#328): minor state defects (docs/STATE_MACHINES.md).
 */

require("./helpers/backendFixtures");

const crypto = require("crypto");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { queryOne, queryAll, run } = require("../src/database");
const { getPool } = require("../src/db/pg");
const {
  createApp,
  ensureWorkspaceSeeded,
  seedDefaultThresholdsForTest,
  signGithubPayload
} = require("./helpers/backendFixtures");
const { interleaveWithHeldRowLock } = require("./helpers/stateMachineFixtures");
const { applyThresholdSuggestion } = require("../src/services/thresholdSuggestionApply");
const { maybeAutoApplyCalibrationSuggestions } = require("../src/services/calibrationAutoApply");
const { recordSuggestionDismissal } = require("../src/services/thresholdSuggestionDismissals");
const { ingestReleaseSignals } = require("../src/services/signalIngest");
const { deleteSignalsForCsvImport } = require("../src/services/signalIngestFromSources");
const { nowIso } = require("../src/lib/time");

const app = createApp();

async function session(prefix) {
  const email = `${prefix}_${crypto.randomBytes(5).toString("hex")}@test.local`;
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ email, password: "password123", name: prefix }).expect(200);
  await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
  const me = await agent.get("/api/auth/me").expect(200);
  return { agent, email, ws: me.body.user.workspace_id, userId: me.body.user.id };
}

async function waitForLockWaiters(count, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await queryOne(
      "SELECT COUNT(*)::int AS c FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()"
    );
    if (row.c >= count) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

function postGithub(payload) {
  const signed = signGithubPayload(payload);
  return request(app)
    .post("/api/hooks/github")
    .set("content-type", "application/json")
    .set("x-github-event", "pull_request")
    .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
    .set("x-hub-signature-256", signed.sig)
    .send(signed.raw);
}

async function connectedRepo(prefix) {
  const s = await session(prefix);
  const repo = `${prefix}${crypto.randomBytes(3).toString("hex")}`;
  await s.agent
    .put(`/api/workspaces/${s.ws}/vcs-integration`)
    .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
    .expect(200);
  await s.agent
    .put(`/api/workspaces/${s.ws}/github-label-trigger`)
    .send({ label_name: "verdikt:rc", enabled: true })
    .expect(200);
  return { ...s, repo };
}

function cautiousAlignment(ws, releaseId) {
  const ts = nowIso();
  return run(
    `INSERT INTO outcome_alignments
      (release_id, workspace_id, recommended_verdict, actual_outcome, alignment,
       signal_deltas_json, outcome_criteria_json, over_block_suggestions_json, computed_at, updated_at)
     VALUES ($1, $2, 'UNCERTIFIED', 'HEALTHY', 'CAUTIOUS', '{}', '[]', $3, $4, $4)
     ON CONFLICT (release_id) DO UPDATE SET over_block_suggestions_json = EXCLUDED.over_block_suggestions_json`,
    [
      releaseId,
      ws,
      JSON.stringify([
        {
          signal_id: "accuracy",
          direction: "lower_min",
          current_threshold: 90,
          suggested_threshold: 85.5,
          rationale: "Prod healthy after block."
        }
      ]),
      ts
    ]
  );
}

async function autoApplyWorkspace() {
  const s = await session("autoapply");
  await ensureWorkspaceSeeded(s.ws);
  await seedDefaultThresholdsForTest(s.ws);
  await run("UPDATE workspace_policies SET calibration_mode = 'auto_apply' WHERE workspace_id = $1", [s.ws]);
  await run("UPDATE thresholds SET min_value = 90 WHERE workspace_id = $1 AND signal_id = 'accuracy'", [s.ws]);
  const created = await s.agent
    .post(`/api/workspaces/${s.ws}/releases`)
    .send({ version: `auto-${crypto.randomBytes(3).toString("hex")}`, release_type: "model_update" })
    .expect(201);
  await cautiousAlignment(s.ws, created.body.id);
  return { ...s, releaseId: created.body.id };
}

async function appliedAuditCount(ws) {
  const row = await queryOne(
    "SELECT COUNT(*)::int AS c FROM audit_events WHERE workspace_id = $1 AND event_type = 'THRESHOLD_SUGGESTION_APPLIED'",
    [ws]
  );
  return row.c;
}

describe("minor state defects (#328)", () => {
  it("concurrent forgot-password requests leave one valid reset token", async () => {
    const s = await session("forgot");
    await request(app).post("/api/auth/forgot-password").send({ email: s.email }).expect(200);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL FOR UPDATE", [
        s.userId
      ]);
      const pending = Promise.all([
        request(app).post("/api/auth/forgot-password").send({ email: s.email }),
        request(app).post("/api/auth/forgot-password").send({ email: s.email })
      ]);
      assert.equal(await waitForLockWaiters(2), true, "both requests should block");
      await client.query("COMMIT");
      await pending;
    } finally {
      client.release();
    }
    const valid = await queryAll("SELECT id FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL", [
      s.userId
    ]);
    assert.equal(valid.length, 1);
  });

  it("revoking an already revoked API key writes no second audit", async () => {
    const s = await session("apikey");
    const created = await s.agent.post(`/api/workspaces/${s.ws}/api-keys`).send({ name: "ci" }).expect(201);
    await s.agent.delete(`/api/workspaces/${s.ws}/api-keys/${created.body.id}`).expect(200);
    const again = await s.agent.delete(`/api/workspaces/${s.ws}/api-keys/${created.body.id}`).expect(200);
    assert.equal(again.body.already_revoked, true);
    const audits = await queryAll(
      "SELECT id FROM audit_events WHERE workspace_id = $1 AND event_type = 'API_KEY_REVOKED'",
      [s.ws]
    );
    assert.equal(audits.length, 1);
  });

  it("applying a min threshold does not overwrite a max committed concurrently", async () => {
    const ws = `ws_thr_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(ws);
    await seedDefaultThresholdsForTest(ws);
    await run("UPDATE thresholds SET min_value = 80, max_value = NULL WHERE workspace_id = $1 AND signal_id = 'accuracy'", [ws]);
    await interleaveWithHeldRowLock(
      {
        lockSql: "SELECT * FROM thresholds WHERE workspace_id = $1 AND signal_id = 'accuracy' FOR UPDATE",
        lockParams: [ws]
      },
      (client) =>
        client.query("UPDATE thresholds SET max_value = 99 WHERE workspace_id = $1 AND signal_id = 'accuracy'", [ws]),
      () =>
        applyThresholdSuggestion(ws, { id: "sug_min", signal_id: "accuracy", direction: "min", suggested: 70 })
    );
    const row = await queryOne(
      "SELECT min_value, max_value FROM thresholds WHERE workspace_id = $1 AND signal_id = 'accuracy'",
      [ws]
    );
    assert.equal(Number(row.min_value), 70);
    assert.equal(Number(row.max_value), 99);
  });

  it("calibration auto-apply does not re-apply on the next alignment", async () => {
    const s = await autoApplyWorkspace();
    const first = await maybeAutoApplyCalibrationSuggestions(s.ws, s.releaseId, "CAUTIOUS");
    assert.equal(first.applied.length, 1);
    const second = await maybeAutoApplyCalibrationSuggestions(s.ws, s.releaseId, "CAUTIOUS");
    assert.equal(second.applied.length, 0);
    assert.equal(await appliedAuditCount(s.ws), 1);
  });

  it("calibration auto-apply skips a dismissed suggestion", async () => {
    const s = await autoApplyWorkspace();
    await recordSuggestionDismissal(s.ws, { signal_id: "accuracy", direction: "min", source: "prod_alignment" });
    const result = await maybeAutoApplyCalibrationSuggestions(s.ws, s.releaseId, "CAUTIOUS");
    assert.equal(result.applied.length, 0);
    assert.equal(await appliedAuditCount(s.ws), 0);
  });

  it("E2: a redelivered label on a locked release does not re-pull integrations", async () => {
    const s = await connectedRepo("labelpull");
    const sha = crypto.randomBytes(20).toString("hex");
    const payload = {
      action: "labeled",
      label: { name: "verdikt:rc" },
      repository: { name: s.repo, owner: { login: "useverdikt" } },
      pull_request: { number: 81, title: "Pull check", head: { sha, ref: "feat/x" } }
    };
    const opened = await postGithub(payload).expect(201);
    await run("UPDATE releases SET status = 'CERTIFIED', verdict_issued_at = $1 WHERE id = $2", [
      nowIso(),
      opened.body.release_id
    ]);
    const again = await postGithub(payload).expect(200);
    assert.equal(again.body.reused, true);
    assert.equal(again.body.integration_pull, "skipped_verdict_locked");
  });

  it("E3: merging into a production branch promotes to prod with bypass bookkeeping", async () => {
    const s = await connectedRepo("prodbranch");
    const sha = crypto.randomBytes(20).toString("hex");
    const created = await s.agent
      .post(`/api/workspaces/${s.ws}/releases`)
      .send({
        version: "prod-branch",
        release_type: "model_update",
        commit_sha: sha,
        pr_number: 91,
        github_owner: "useverdikt",
        github_repo: s.repo
      })
      .expect(201);
    await run("UPDATE releases SET status = 'UNCERTIFIED', verdict_issued_at = $1 WHERE id = $2", [
      nowIso(),
      created.body.id
    ]);
    const hook = await postGithub({
      action: "closed",
      repository: { name: s.repo, owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 91, base: { ref: "production" }, head: { sha } }
    }).expect(200);
    assert.equal(hook.body.environment, "prod");
    const rel = await queryOne("SELECT environment, shipped_without_certification FROM releases WHERE id = $1", [
      created.body.id
    ]);
    assert.equal(rel.environment, "prod");
    assert.equal(Number(rel.shipped_without_certification), 1);
  });

  it("signal ingest re-checks the verdict lock inside its transaction", async () => {
    const s = await session("ingestlock");
    const created = await s.agent
      .post(`/api/workspaces/${s.ws}/releases`)
      .send({ version: "ingest-lock", release_type: "model_update" })
      .expect(201);
    const stale = await queryOne("SELECT * FROM releases WHERE id = $1", [created.body.id]);
    await run("UPDATE releases SET status = 'CERTIFIED', verdict_issued_at = $1 WHERE id = $2", [nowIso(), stale.id]);
    await assert.rejects(
      () => ingestReleaseSignals({ release: stale, signals: { accuracy: 91 }, source: "manual" }),
      (error) => error.status === 409
    );
    const rows = await queryAll("SELECT id FROM signals WHERE release_id = $1", [stale.id]);
    assert.equal(rows.length, 0);
  });

  it("replacing a CSV import keeps the signals a locked release was certified on", async () => {
    const s = await session("csvlock");
    const created = await s.agent
      .post(`/api/workspaces/${s.ws}/releases`)
      .send({ version: "csv-lock", release_type: "model_update" })
      .expect(201);
    const importId = `imp_${crypto.randomBytes(4).toString("hex")}`;
    await run(
      "INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'accuracy', 92, $2, $3)",
      [created.body.id, `csv:${importId}`, nowIso()]
    );
    await run("UPDATE releases SET status = 'CERTIFIED', verdict_issued_at = $1 WHERE id = $2", [
      nowIso(),
      created.body.id
    ]);
    await deleteSignalsForCsvImport(importId);
    const rows = await queryAll("SELECT id FROM signals WHERE release_id = $1", [created.body.id]);
    assert.equal(rows.length, 1);
  });
});

describe("minor state regression guards", () => {
  it("a first API key revoke still writes its audit", async () => {
    const s = await session("apikeyguard");
    const created = await s.agent.post(`/api/workspaces/${s.ws}/api-keys`).send({ name: "ci" }).expect(201);
    const revoked = await s.agent.delete(`/api/workspaces/${s.ws}/api-keys/${created.body.id}`).expect(200);
    assert.ok(revoked.body.revoked_at);
    const audits = await queryAll(
      "SELECT id FROM audit_events WHERE workspace_id = $1 AND event_type = 'API_KEY_REVOKED'",
      [s.ws]
    );
    assert.equal(audits.length, 1);
  });

  it("merging into a feature branch is not a prod promotion", async () => {
    const s = await connectedRepo("featbranch");
    const sha = crypto.randomBytes(20).toString("hex");
    const created = await s.agent
      .post(`/api/workspaces/${s.ws}/releases`)
      .send({
        version: "feat-branch",
        release_type: "model_update",
        commit_sha: sha,
        pr_number: 92,
        github_owner: "useverdikt",
        github_repo: s.repo
      })
      .expect(201);
    const hook = await postGithub({
      action: "closed",
      repository: { name: s.repo, owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 92, base: { ref: "staging" }, head: { sha } }
    }).expect(200);
    assert.equal(hook.body.environment, "staging");
    const rel = await queryOne("SELECT environment FROM releases WHERE id = $1", [created.body.id]);
    assert.equal(rel.environment, "staging");
  });

  it("ingest into a collecting release still inserts signals", async () => {
    const s = await session("ingestok");
    const created = await s.agent
      .post(`/api/workspaces/${s.ws}/releases`)
      .send({ version: "ingest-ok", release_type: "model_update" })
      .expect(201);
    const release = await queryOne("SELECT * FROM releases WHERE id = $1", [created.body.id]);
    const out = await ingestReleaseSignals({ release, signals: { accuracy: 91 }, source: "manual" });
    assert.equal(out.insertedCount, 1);
  });
});
