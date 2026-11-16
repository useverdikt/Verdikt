"use strict";

/**
 * Gate actions must name a step that can succeed (docs/STATE_MACHINES.md §4,
 * issue G), and the merge-time bypass flag must match the gate's policy (E4).
 */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { initDatabase, run, queryOne } = require("../src/database");
const { buildReleaseGateResponse } = require("../src/services/releaseGate");
const { persistCertificationSnapshot } = require("../src/services/certificationSnapshots");
const { promoteReleaseOnMerge } = require("../src/services/releaseEnvironment");
const { computeGateAction, COLLECTION_GRACE_MS } = require("../src/services/releaseIdentity");
const { nowIso } = require("../src/lib/time");
const { seedWorkspaceWithRequiredSignals, insertRelease, insertSignal } = require("./helpers/stateMachineFixtures");

before(async () => {
  await initDatabase();
});

async function setGateMode(wsId, mode) {
  await run("UPDATE workspace_policies SET gate_mode = $1 WHERE workspace_id = $2", [mode, wsId]);
}

async function freezeSnapshot(release, status) {
  await persistCertificationSnapshot({
    releaseId: release.id,
    workspaceId: release.workspace_id,
    thresholdMap: { accuracy: { min: 50, max: null, required_for_certification: 1 } },
    signalMap: { accuracy: 90 },
    status
  });
}

async function openRemediationDebt(wsId) {
  const bypass = await insertRelease(wsId, { status: "UNCERTIFIED", environment: "prod", verdictIssued: true });
  await run(
    "UPDATE releases SET shipped_without_certification = 1, shipped_without_certification_at = $1 WHERE id = $2",
    [nowIso(), bypass.id]
  );
}

function gate(release, mode) {
  return buildReleaseGateResponse(release, { mode, skipAudit: true });
}

function mergeToMain(release) {
  return promoteReleaseOnMerge(release, {
    workspaceId: release.workspace_id,
    prNumber: 1,
    baseBranch: "main",
    newEnv: "prod",
    isMainBranch: true
  });
}

describe("gate actions name a step that can succeed", () => {
  it("strict-mode override returns recover_certification, not self_heal", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "CERTIFIED_WITH_OVERRIDE", verdictIssued: true });
    await freezeSnapshot(release, "CERTIFIED_WITH_OVERRIDE");

    const out = await gate(release, "strict");
    assert.equal(out.action, "recover_certification");
    assert.equal(out.gate.exit_code, 1);
    assert.ok(out.blockers.some((b) => b.type === "strict_mode"));
    assert.match(out.governance_brief.agent_note, /Strict mode/);

    const relaxed = await gate(release, "default");
    assert.equal(relaxed.action, "merge");
  });

  it("a collecting release under remediation debt keeps collecting instead of failing CI", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    await openRemediationDebt(wsId);
    const release = await insertRelease(wsId, { status: "COLLECTING" });

    const out = await gate(release);
    assert.equal(out.remediation_debt.active, true);
    assert.equal(out.action, "collecting");
  });

  it("a production UNCERTIFIED release with missing signals escalates instead of self_heal", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "UNCERTIFIED", environment: "prod", verdictIssued: true });
    await insertSignal(release.id, "accuracy", 90);

    const out = await gate(release);
    assert.deepEqual(out.missing_required_signals, ["safety"]);
    assert.equal(out.action, "escalate");
    assert.equal(out.blockers[0].type, "prod_locked");
    assert.equal(out.governance_brief.suggested_next_tool, "escalate");
  });

  it("a pre-prod UNCERTIFIED release with missing signals still self-heals", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "UNCERTIFIED", verdictIssued: true });
    await insertSignal(release.id, "accuracy", 90);

    const out = await gate(release);
    assert.equal(out.action, "self_heal");
    assert.ok(!out.blockers.some((b) => b.type === "prod_locked"));
  });

  it("computeGateAction orders debt, strict, and prod lock after collecting", () => {
    const base = { gateAllowed: false, blockingSignals: [], missingRequiredSignals: ["safety"] };
    assert.equal(
      computeGateAction({ ...base, status: "COLLECTING", collectionAgeMs: COLLECTION_GRACE_MS, blockedByRemediationDebt: true }),
      "self_heal"
    );
    assert.equal(
      computeGateAction({ ...base, status: "UNCERTIFIED", prodLocked: true, blockedByRemediationDebt: true }),
      "recover_certification"
    );
    assert.equal(computeGateAction({ ...base, status: "CERTIFIED_WITH_OVERRIDE", strictBlocked: true }), "recover_certification");
  });
});

describe("merge-time bypass follows the gate's policy decision", () => {
  it("flags a strict-mode override merged to main", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    await setGateMode(wsId, "strict");
    const release = await insertRelease(wsId, { status: "CERTIFIED_WITH_OVERRIDE", verdictIssued: true });

    const result = await mergeToMain(release);
    assert.equal(result.shipped_without_certification, true);
    const audit = await queryOne(
      "SELECT details_json FROM audit_events WHERE release_id = $1 AND event_type = 'RELEASE_SHIPPED_WITHOUT_CERTIFICATION'",
      [release.id]
    );
    const details = typeof audit.details_json === "string" ? JSON.parse(audit.details_json) : audit.details_json;
    assert.equal(details.bypass_reason, "strict_mode");
  });

  it("flags an override merged while remediation debt is active", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    await openRemediationDebt(wsId);
    const release = await insertRelease(wsId, { status: "CERTIFIED_WITH_OVERRIDE", verdictIssued: true });

    const result = await mergeToMain(release);
    assert.equal(result.shipped_without_certification, true);
  });

  it("does not flag a default-mode override or a certified release", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const override = await insertRelease(wsId, { status: "CERTIFIED_WITH_OVERRIDE", verdictIssued: true });
    const certified = await insertRelease(wsId, { status: "CERTIFIED", verdictIssued: true });
    await setGateMode(wsId, "default");

    assert.equal((await mergeToMain(override)).shipped_without_certification, false);
    assert.equal((await mergeToMain(certified)).shipped_without_certification, false);
  });
});
