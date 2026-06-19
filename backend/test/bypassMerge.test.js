"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.GITHUB_WEBHOOK_SECRET = "test-github-webhook-secret-32-min";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";

const crypto = require("crypto");
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { initDatabase, queryOne, queryAll, run } = require("../src/database");
const { createApp } = require("../src/app");
const { applyReleaseOverride } = require("../src/services/releaseOverride");
const { buildReleaseGateResponse } = require("../src/services/releaseGate");
const { getWorkspaceRemediationDebt } = require("../src/services/remediationDebt");
const { nowIso } = require("../src/lib/time");

let app;

function signGithubPayload(payload) {
  const raw = JSON.stringify(payload);
  const sig = `sha256=${crypto.createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET).update(raw).digest("hex")}`;
  return { raw, sig };
}

before(async () => {
  await initDatabase();
  app = createApp();
});

describe("bypass merge prod tracking", () => {
  it("UNCERTIFIED merge sets frozen shipped_without_certification at merge time", async () => {
    const email = `byp_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "BYP" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const repo = `BypassFlag${crypto.randomBytes(3).toString("hex")}`;
    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Bypass flag test (#9191)", release_type: "model_update", pr_number: 9191 })
      .expect(201);

    await run("UPDATE releases SET status = ?, updated_at = ? WHERE id = ?", [
      "UNCERTIFIED",
      nowIso(),
      created.body.id
    ]);

    const payload = {
      action: "closed",
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 9191, base: { ref: "main" } }
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

    assert.equal(hook.body.shipped_without_certification, 1);

    const rel = await queryOne("SELECT * FROM releases WHERE id = ?", [created.body.id]);
    assert.equal(rel.environment, "prod");
    assert.equal(Number(rel.shipped_without_certification), 1);
    assert.ok(rel.shipped_without_certification_at);

    const bypassAudit = await queryOne(
      "SELECT * FROM audit_events WHERE release_id = ? AND event_type = ?",
      [created.body.id, "RELEASE_SHIPPED_WITHOUT_CERTIFICATION"]
    );
    assert.ok(bypassAudit);

    // Status change must not clear the frozen bypass flag.
    await run("UPDATE releases SET status = ? WHERE id = ?", ["CERTIFIED_WITH_OVERRIDE", created.body.id]);
    const afterOverride = await queryOne(
      "SELECT shipped_without_certification, shipped_without_certification_at FROM releases WHERE id = ?",
      [created.body.id]
    );
    assert.equal(Number(afterOverride.shipped_without_certification), 1);
    assert.equal(afterOverride.shipped_without_certification_at, rel.shipped_without_certification_at);
  });

  it("prod bypass merge refreshes recommendation to incident suggested actions", async () => {
    const email = `byprec_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "BYPREC" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const repo = `BypassRec${crypto.randomBytes(3).toString("hex")}`;
    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Rec refresh (#9393)", release_type: "model_update", pr_number: 9393 })
      .expect(201);

    await run("UPDATE releases SET status = ?, updated_at = ? WHERE id = ?", [
      "UNCERTIFIED",
      nowIso(),
      created.body.id
    ]);
    await run(
      `INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES (?, 'accuracy', 50, 't', ?)`,
      [created.body.id, nowIso()]
    );

    const { computeAndPersistRecommendation } = require("../src/services/recommendationEngine");
    const preProd = await queryOne("SELECT * FROM releases WHERE id = ?", [created.body.id]);
    await computeAndPersistRecommendation(preProd);
    const preRow = await queryOne("SELECT recommendation_json FROM release_intelligence WHERE release_id = ?", [
      created.body.id
    ]);
    const preRec = JSON.parse(preRow.recommendation_json);
    assert.ok(
      preRec.suggested_actions.some((a) => /re-run signal|do not proceed/i.test(a)),
      "pre-prod recommendation should include pre-ship actions"
    );

    const payload = {
      action: "closed",
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 9393, base: { ref: "main" } }
    };
    const signed = signGithubPayload(payload);
    await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(200);

    const postRow = await queryOne("SELECT recommendation_json FROM release_intelligence WHERE release_id = ?", [
      created.body.id
    ]);
    const postRec = JSON.parse(postRow.recommendation_json);
    assert.ok(
      postRec.suggested_actions.some((a) => /rollback|escalate|live in production/i.test(a)),
      `expected prod incident actions, got: ${JSON.stringify(postRec.suggested_actions)}`
    );
    assert.ok(!postRec.suggested_actions.some((a) => /re-run signal ingest/i.test(a)));
  });

  it("bypass_merge_then_verdict_does_not_open_monitoring_window_twice", async () => {
    const email = `byp2_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "BYP2" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const repo = `BypassMon${crypto.randomBytes(3).toString("hex")}`;
    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({
        version: "Monitoring idempotency (#9292)",
        release_type: "model_update",
        pr_number: 9292,
        commit_sha: "abc123def456"
      })
      .expect(201);
    const releaseId = created.body.id;

    const mergePayload = {
      action: "closed",
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 9292, base: { ref: "main" } }
    };
    const signedMerge = signGithubPayload(mergePayload);
    await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signedMerge.sig)
      .send(signedMerge.raw)
      .expect(200);

    const windowsAfterMerge = await queryAll(
      "SELECT * FROM vcs_monitoring_windows WHERE release_id = ?",
      [releaseId]
    );
    assert.equal(windowsAfterMerge.length, 1, "merge should open exactly one monitoring window");

    await run("UPDATE releases SET collection_deadline = ? WHERE id = ?", [
      new Date(Date.now() - 60_000).toISOString(),
      releaseId
    ]);

    await agent
      .post(`/api/releases/${releaseId}/signals`)
      .send({
        source: "test",
        signals: { accuracy: 90, safety: 95, tone: 90, hallucination: 95, relevance: 85 }
      })
      .expect(200);

    const windowsAfterVerdict = await queryAll(
      "SELECT * FROM vcs_monitoring_windows WHERE release_id = ?",
      [releaseId]
    );
    assert.equal(
      windowsAfterVerdict.length,
      1,
      "post-verdict effects must not open a second monitoring window after bypass merge"
    );
  });

  it("retroactive override emits RETROACTIVE_OVERRIDE_AFTER_BYPASS_MERGE audit", async () => {
    const email = `byp3_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "BYP3" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const repo = `BypassRetro${crypto.randomBytes(3).toString("hex")}`;
    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);

    const created = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Retro override (#9393)", release_type: "model_update", pr_number: 9393 })
      .expect(201);
    const releaseId = created.body.id;

    await run("UPDATE releases SET status = ? WHERE id = ?", ["UNCERTIFIED", releaseId]);

    const mergePayload = {
      action: "closed",
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 9393, base: { ref: "main" } }
    };
    const signedMerge = signGithubPayload(mergePayload);
    await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signedMerge.sig)
      .send(signedMerge.raw)
      .expect(200);

    const release = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
    const out = await applyReleaseOverride(release, {
      approver_name: "VP Eng",
      approver_role: "VP_ENGINEERING",
      justification: "Production incident contained; accepting residual risk with monitoring.",
      metadata: {
        impact_summary: "Sub-0.5% user cohort affected by latency spike.",
        mitigation_plan: "Rollback script staged; on-call watching error budget for 48h.",
        follow_up_due_date: "2026-07-01"
      }
    });
    assert.equal(out.ok, true);

    const retroAudit = await queryOne(
      "SELECT * FROM audit_events WHERE release_id = ? AND event_type = ?",
      [releaseId, "RETROACTIVE_OVERRIDE_AFTER_BYPASS_MERGE"]
    );
    assert.ok(retroAudit, "retroactive bypass override must emit dedicated audit event");

    const overrideAudit = await queryOne(
      "SELECT * FROM audit_events WHERE release_id = ? AND event_type = ?",
      [releaseId, "OVERRIDE_APPROVED"]
    );
    assert.ok(overrideAudit);

    const overrideRow = await queryOne("SELECT metadata_json FROM overrides WHERE release_id = ?", [releaseId]);
    const meta = JSON.parse(overrideRow.metadata_json || "{}");
    assert.equal(meta.retroactive, true);
  });

  it("workspace releases list exposes shipped_without_certification_count", async () => {
    const email = `byp4_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "BYP4" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const list = await agent.get(`/api/workspaces/${ws}/releases`).expect(200);
    assert.equal(typeof list.body.shipped_without_certification_count, "number");
    assert.equal(typeof list.body.production_incidents_count, "number");
    assert.equal(typeof list.body.remediation_debt_active, "boolean");
    assert.ok(list.body.releases.every((r) => "shipped_without_certification" in r));
  });

  it("remediation debt blocks override gate after emergency merge", async () => {
    const email = `bypdebt_${crypto.randomBytes(6).toString("hex")}@test.local`;
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email, password: "password123", name: "BYP Debt" }).expect(200);
    await agent.post("/api/auth/login").send({ email, password: "password123" }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    const ws = me.body.user.workspace_id;

    const repo = `BypassDebt${crypto.randomBytes(3).toString("hex")}`;
    await agent
      .put(`/api/workspaces/${ws}/vcs-integration`)
      .send({ provider: "github", access_token: "ghp_test_token", owner: "useverdikt", repo })
      .expect(200);

    const bypassRelease = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Emergency merge (#9292)", release_type: "model_update", pr_number: 9292 })
      .expect(201);
    await run("UPDATE releases SET status = ?, updated_at = ? WHERE id = ?", [
      "UNCERTIFIED",
      nowIso(),
      bypassRelease.body.id
    ]);

    const payload = {
      action: "closed",
      repository: { name: repo, owner: { login: "useverdikt" } },
      pull_request: { merged: true, number: 9292, base: { ref: "main" } }
    };
    const signed = signGithubPayload(payload);
    await request(app)
      .post("/api/hooks/github")
      .set("content-type", "application/json")
      .set("x-github-event", "pull_request")
      .set("x-github-delivery", `test-${crypto.randomBytes(6).toString("hex")}`)
      .set("x-hub-signature-256", signed.sig)
      .send(signed.raw)
      .expect(200);

    const debt = await getWorkspaceRemediationDebt(ws);
    assert.equal(debt.active, true);

    const overrideRelease = await agent
      .post(`/api/workspaces/${ws}/releases`)
      .send({ version: "Follow-up override (#9293)", release_type: "model_update", pr_number: 9293 })
      .expect(201);
    await run("UPDATE releases SET status = ? WHERE id = ?", [
      "CERTIFIED_WITH_OVERRIDE",
      overrideRelease.body.id
    ]);

    const rel = await queryOne("SELECT * FROM releases WHERE id = ?", [overrideRelease.body.id]);
    const gate = await buildReleaseGateResponse(rel, { mode: "default" });
    assert.equal(gate.remediation_debt.active, true);
    assert.equal(gate.can_merge, false);
    assert.match(String(gate.gate.reason), /emergency merge/i);
    const debtBlocker = gate.blockers.find((b) => b.type === "remediation_debt");
    assert.ok(debtBlocker, "gate must include structured remediation_debt blocker");
    assert.equal(debtBlocker.source_version, "Emergency merge (#9292)");
  });
});
