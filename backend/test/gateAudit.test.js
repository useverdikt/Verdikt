"use strict";

require("./helpers/backendFixtures");

const crypto = require("crypto");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { queryOne } = require("../src/database");
const {
  GATE_AUDIT_HEARTBEAT_MS,
  writeGateAuditIfNeeded
} = require("../src/services/gateAudit");
const { verifyAuditIntegrity } = require("../src/services/auditIntegrity");
const { runWithAuditContext } = require("../src/lib/auditContext");
const { ensureWorkspaceSeeded } = require("./helpers/backendFixtures");

function gateDetails(action = "collecting") {
  return {
    mode: "default",
    allowed: action === "merge",
    status: action === "collecting" ? "COLLECTING" : "UNCERTIFIED",
    reason: action === "collecting" ? "release still collecting required signals" : "release is uncertified",
    trajectory: "UNKNOWN",
    action,
    commit_sha: null
  };
}

async function countGateAudits(workspaceId, releaseId) {
  const row = await queryOne(
    `SELECT COUNT(*)::int AS count
       FROM audit_events
      WHERE workspace_id = $1
        AND release_id = $2
        AND event_type = 'RELEASE_GATE_CHECKED'`,
    [workspaceId, releaseId]
  );
  return Number(row?.count || 0);
}

describe("gate audit coalescing", () => {
  it("writes first, changed, and heartbeat results but coalesces recent duplicates", async () => {
    const workspaceId = `ws_gate_audit_${crypto.randomBytes(4).toString("hex")}`;
    const releaseId = `rel_gate_audit_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(workspaceId);
    const nowMs = Date.now();
    const base = {
      workspaceId,
      releaseId,
      actorType: "SYSTEM",
      actorName: "ci_pipeline"
    };

    const first = await writeGateAuditIfNeeded({
      ...base,
      details: gateDetails(),
      nowMs
    });
    const duplicate = await writeGateAuditIfNeeded({
      ...base,
      details: gateDetails(),
      nowMs: nowMs + 1_000
    });
    const changed = await writeGateAuditIfNeeded({
      ...base,
      details: gateDetails("self_heal"),
      nowMs: nowMs + 2_000
    });
    const heartbeat = await writeGateAuditIfNeeded({
      ...base,
      details: gateDetails("self_heal"),
      nowMs: nowMs + GATE_AUDIT_HEARTBEAT_MS + 2_000
    });

    assert.deepEqual(first, { written: true, reason: "first_result" });
    assert.deepEqual(duplicate, {
      written: false,
      reason: "unchanged_within_heartbeat"
    });
    assert.deepEqual(changed, { written: true, reason: "result_changed" });
    assert.deepEqual(heartbeat, { written: true, reason: "heartbeat_elapsed" });
    assert.equal(await countGateAudits(workspaceId, releaseId), 3);
    assert.equal((await verifyAuditIntegrity(workspaceId)).valid, true);
  });

  it("allows only one unchanged write across concurrent replicas", async () => {
    const workspaceId = `ws_gate_race_${crypto.randomBytes(4).toString("hex")}`;
    const releaseId = `rel_gate_race_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(workspaceId);

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        writeGateAuditIfNeeded({
          workspaceId,
          releaseId,
          actorType: "AGENT",
          actorName: "gate-test-key",
          details: gateDetails()
        })
      )
    );

    assert.equal(outcomes.filter((outcome) => outcome.written).length, 1);
    assert.equal(await countGateAudits(workspaceId, releaseId), 1);
    assert.equal((await verifyAuditIntegrity(workspaceId)).valid, true);
  });

  it("keeps the first gate result for each agent session", async () => {
    const workspaceId = `ws_gate_session_${crypto.randomBytes(4).toString("hex")}`;
    const releaseId = `rel_gate_session_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(workspaceId);
    const writeForSession = (agentSessionId) =>
      runWithAuditContext({ agentSessionId }, () =>
        writeGateAuditIfNeeded({
          workspaceId,
          releaseId,
          actorType: "AGENT",
          actorName: "shared-gate-key",
          details: gateDetails()
        })
      );

    const firstA = await writeForSession("session-a");
    const duplicateA = await writeForSession("session-a");
    const firstB = await writeForSession("session-b");

    assert.equal(firstA.written, true);
    assert.equal(duplicateA.written, false);
    assert.equal(firstB.written, true);
    assert.equal(await countGateAudits(workspaceId, releaseId), 2);
  });
});
