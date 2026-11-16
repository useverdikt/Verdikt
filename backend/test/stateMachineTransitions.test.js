"use strict";

/**
 * Regression tests for release / escalation state-machine transitions that
 * were reachable through retries and concurrency. See
 * docs/STATE_MACHINES.md for the transition tables these tests pin.
 */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.NODE_ENV = "test";
process.env.LOG_REQUESTS = "0";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { initDatabase, run, queryOne, queryAll } = require("../src/database");
const { evaluateReleaseAfterSignalIngest } = require("../src/services/domain");
const { applyReleaseOverride } = require("../src/services/releaseOverride");
const { revokeReleaseCertification } = require("../src/services/releaseRevoke");
const { extendCollectionDeadline } = require("../src/services/collectionDeadline");
const { ingestReleaseSignals } = require("../src/services/signalIngest");
const { persistCertificationSnapshot } = require("../src/services/certificationSnapshots");
const {
  createEscalationRequest,
  acknowledgeEscalation,
  acknowledgeEscalationWithOverride,
  PENDING,
  RESOLVED
} = require("../src/services/escalations");
const { nowIso } = require("../src/lib/time");
const {
  rid,
  seedWorkspaceWithRequiredSignals,
  insertRelease,
  insertSignal,
  auditCount,
  interleaveWithHeldRowLock
} = require("./helpers/stateMachineFixtures");

before(async () => {
  await initDatabase();
});

const OVERRIDE_INPUT = Object.freeze({
  approver_name: "vp@example.test",
  approver_role: "vp_engineering",
  justification: "Known flaky eval; shipping behind a flag with rollback ready.",
  metadata: {
    impact_summary: "Low blast radius behind a feature flag",
    mitigation_plan: "Roll back the flag within five minutes",
    follow_up_due_date: "2026-12-01"
  }
});

describe("release status: COLLECTING write cannot clobber a committed verdict", () => {
  it("a stale still-collecting evaluation does not reset a concurrently CERTIFIED release", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId);
    await insertSignal(release.id, "accuracy", 90);

    const { blocked } = await interleaveWithHeldRowLock(
      { lockSql: "SELECT id FROM releases WHERE id = $1 FOR UPDATE", lockParams: [release.id] },
      (client) =>
        client.query(
          "UPDATE releases SET status = 'CERTIFIED', verdict_issued_at = $2, updated_at = $2 WHERE id = $1",
          [release.id, nowIso()]
        ),
      () => evaluateReleaseAfterSignalIngest(release, release.id, "test", 1)
    );

    assert.equal(blocked, true, "evaluation should have waited on the release row lock");
    const row = await queryOne("SELECT status FROM releases WHERE id = $1", [release.id]);
    assert.equal(row.status, "CERTIFIED");
  });
});

describe("release status: CERTIFICATION_REVOKED is terminal", () => {
  it("evaluation never rewrites a revoked release", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "CERTIFICATION_REVOKED", deadlineOffsetMs: -60_000, verdictIssued: true });
    await insertSignal(release.id, "accuracy", 90);
    await insertSignal(release.id, "safety", 90);

    const staleRow = { ...release, status: "COLLECTING" };
    const out = await evaluateReleaseAfterSignalIngest(staleRow, release.id, "test", 2);

    assert.equal(out, null);
    const row = await queryOne("SELECT status FROM releases WHERE id = $1", [release.id]);
    assert.equal(row.status, "CERTIFICATION_REVOKED");
    assert.equal(await auditCount(release.id, "SIGNALS_INGESTED"), 0);
  });

  it("override is rejected for a revoked release and frozen evidence is untouched", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "CERTIFICATION_REVOKED", deadlineOffsetMs: -60_000, verdictIssued: true });
    await persistCertificationSnapshot({
      releaseId: release.id,
      workspaceId: wsId,
      thresholdMap: { accuracy: { min: 50, max: null, required_for_certification: 1 } },
      signalMap: { accuracy: 90 },
      status: "CERTIFIED"
    });
    const before = await queryOne("SELECT evidence_hash FROM certification_snapshots WHERE release_id = $1", [release.id]);

    const out = await applyReleaseOverride(release, OVERRIDE_INPUT);

    assert.equal(out.ok, false);
    assert.equal(out.statusCode, 409);
    const row = await queryOne("SELECT status FROM releases WHERE id = $1", [release.id]);
    assert.equal(row.status, "CERTIFICATION_REVOKED");
    const after = await queryOne("SELECT evidence_hash FROM certification_snapshots WHERE release_id = $1", [release.id]);
    assert.equal(after.evidence_hash, before.evidence_hash);
    assert.equal(await auditCount(release.id, "OVERRIDE_APPROVED"), 0);
  });
});

describe("release status: override re-checks status under the row lock", () => {
  it("rejects an override built from a stale UNCERTIFIED row once the release is CERTIFIED", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "UNCERTIFIED", deadlineOffsetMs: -60_000, verdictIssued: true });
    await run("UPDATE releases SET status = 'CERTIFIED' WHERE id = $1", [release.id]);

    const out = await applyReleaseOverride(release, OVERRIDE_INPUT);

    assert.equal(out.ok, false);
    const row = await queryOne("SELECT status FROM releases WHERE id = $1", [release.id]);
    assert.equal(row.status, "CERTIFIED");
    assert.equal(await auditCount(release.id, "OVERRIDE_APPROVED"), 0);
  });

  it("concurrent overrides commit exactly once", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "UNCERTIFIED", deadlineOffsetMs: -60_000, verdictIssued: true });

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => applyReleaseOverride(release, OVERRIDE_INPUT, { skipSideEffects: true }))
    );

    assert.equal(outcomes.filter((o) => o.ok).length, 1);
    assert.equal(await auditCount(release.id, "OVERRIDE_APPROVED"), 1);
    const history = await queryOne("SELECT COUNT(*) AS c FROM override_history WHERE release_id = $1", [release.id]);
    assert.equal(Number(history.c), 1);
  });
});

describe("release status: revoke re-checks status under the row lock", () => {
  it("concurrent revokes write one audit event and one outbox intent", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "CERTIFIED", deadlineOffsetMs: -60_000, verdictIssued: true });

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () =>
        revokeReleaseCertification(release, {
          actorName: "cto@example.test",
          actorRole: "cto",
          justification: "Production incident traced to this model"
        })
      )
    );

    assert.equal(outcomes.filter((o) => o.ok).length, 1);
    assert.equal(await auditCount(release.id, "CERTIFICATION_REVOKED"), 1);
    const perEffect = await queryAll(
      `SELECT effect_type, COUNT(*) AS c FROM outbound_effect_outbox
        WHERE release_id = $1 AND verdict_status = 'CERTIFICATION_REVOKED'
        GROUP BY effect_type`,
      [release.id]
    );
    assert.ok(perEffect.length > 0, "revoke should enqueue delivery intent");
    for (const row of perEffect) {
      assert.equal(Number(row.c), 1, `duplicate ${row.effect_type} revoke intent`);
    }
  });
});

describe("collection deadline: verdicts and extensions observe each other", () => {
  it("evaluation uses the stored deadline, not the caller's stale copy", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { deadlineOffsetMs: -60_000 });
    await insertSignal(release.id, "accuracy", 90);
    const staleRow = { ...release };
    await run("UPDATE releases SET collection_deadline = $1 WHERE id = $2", [
      new Date(Date.now() + 30 * 60_000).toISOString(),
      release.id
    ]);

    const out = await evaluateReleaseAfterSignalIngest(staleRow, release.id, "collection_deadline_sweep", 0);

    assert.equal(out?.status, "COLLECTING");
    const row = await queryOne("SELECT status, verdict_issued_at FROM releases WHERE id = $1", [release.id]);
    assert.equal(row.status, "COLLECTING");
    assert.equal(row.verdict_issued_at, null);
  });

  it("extension is rejected once the release has left COLLECTING", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { deadlineOffsetMs: -60_000 });
    await run("UPDATE releases SET status = 'UNCERTIFIED', verdict_issued_at = $2 WHERE id = $1", [release.id, nowIso()]);

    await assert.rejects(() => extendCollectionDeadline(release, 30), (err) => err.status === 409);

    const row = await queryOne("SELECT collection_deadline FROM releases WHERE id = $1", [release.id]);
    assert.equal(new Date(row.collection_deadline).getTime(), new Date(release.collection_deadline).getTime());
    assert.equal(await auditCount(release.id, "COLLECTION_DEADLINE_EXTENDED"), 0);
  });
});

describe("signal ingest: skipped evaluation still answers with release state", () => {
  it("returns the current verdict when a concurrent writer already certified the release", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId);
    await insertSignal(release.id, "accuracy", 90);
    await insertSignal(release.id, "safety", 90);

    // The concurrent certification lands after the insert commits and before evaluation.
    const out = await ingestReleaseSignals({
      release,
      signals: { accuracy: 91 },
      source: "test",
      idempotencyKey: rid("idem"),
      beforeEvaluate: () =>
        run("UPDATE releases SET status = 'CERTIFIED', verdict_issued_at = $2 WHERE id = $1", [release.id, nowIso()])
    });

    assert.equal(out.kind, "ingested");
    assert.ok(out.response, "response must not be null");
    assert.equal(out.response.status, "CERTIFIED");
    assert.equal(out.response.evaluation_skipped, true);
    assert.ok(out.response.idempotency_key);
  });
});

describe("escalation lifecycle", () => {
  it("concurrent escalate calls keep a single pending escalation per release", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "UNCERTIFIED", deadlineOffsetMs: -60_000, verdictIssued: true });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createEscalationRequest({
          workspaceId: wsId,
          releaseId: release.id,
          reason: `blocked on accuracy (${i})`,
          requestedByType: "AGENT",
          requestedByName: "agent",
          releaseStatus: "UNCERTIFIED"
        })
      )
    );

    const ids = new Set(results.map((r) => r.escalation.id));
    assert.equal(ids.size, 1);
    const pending = await queryOne(
      "SELECT COUNT(*) AS c FROM escalation_requests WHERE release_id = $1 AND state = $2",
      [release.id, PENDING]
    );
    assert.equal(Number(pending.c), 1);
  });

  it("concurrent acknowledgements resolve once and audit once", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "UNCERTIFIED", deadlineOffsetMs: -60_000, verdictIssued: true });
    const { escalation } = await createEscalationRequest({
      workspaceId: wsId,
      releaseId: release.id,
      reason: "blocked",
      requestedByType: "AGENT",
      requestedByName: "agent",
      releaseStatus: "UNCERTIFIED"
    });

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () =>
        acknowledgeEscalation({ workspaceId: wsId, escalationId: escalation.id, actorEmail: "vp@example.test" })
      )
    );

    assert.equal(outcomes.filter((o) => o.ok).length, 1);
    assert.equal(await auditCount(release.id, "ESCALATION_ACKNOWLEDGED"), 1);
  });

  it("a direct override resolves the release's pending escalation", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "UNCERTIFIED", deadlineOffsetMs: -60_000, verdictIssued: true });
    const { escalation } = await createEscalationRequest({
      workspaceId: wsId,
      releaseId: release.id,
      reason: "blocked",
      requestedByType: "AGENT",
      requestedByName: "agent",
      releaseStatus: "UNCERTIFIED"
    });

    const out = await applyReleaseOverride(release, OVERRIDE_INPUT, { skipSideEffects: true });
    assert.equal(out.ok, true);

    const row = await queryOne("SELECT state FROM escalation_requests WHERE id = $1", [escalation.id]);
    assert.equal(row.state, RESOLVED);
    assert.equal(await auditCount(release.id, "ESCALATION_AUTO_RESOLVED"), 1);
  });

  it("an engine certification resolves the release's pending escalation", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { deadlineOffsetMs: -60_000 });
    const { escalation } = await createEscalationRequest({
      workspaceId: wsId,
      releaseId: release.id,
      reason: "waiting on evals",
      requestedByType: "AGENT",
      requestedByName: "agent",
      releaseStatus: "COLLECTING"
    });
    await insertSignal(release.id, "accuracy", 90);
    await insertSignal(release.id, "safety", 90);

    const out = await evaluateReleaseAfterSignalIngest(release, release.id, "test", 2);
    assert.equal(out?.status, "CERTIFIED");

    const row = await queryOne("SELECT state FROM escalation_requests WHERE id = $1", [escalation.id]);
    assert.equal(row.state, RESOLVED);
  });

  it("acknowledge-and-override on an escalation already resolved by a direct override reports not_pending", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "UNCERTIFIED", deadlineOffsetMs: -60_000, verdictIssued: true });
    const { escalation } = await createEscalationRequest({
      workspaceId: wsId,
      releaseId: release.id,
      reason: "blocked",
      requestedByType: "AGENT",
      requestedByName: "agent",
      releaseStatus: "UNCERTIFIED"
    });
    await applyReleaseOverride(release, OVERRIDE_INPUT, { skipSideEffects: true });

    const out = await acknowledgeEscalationWithOverride({
      workspaceId: wsId,
      escalationId: escalation.id,
      actorEmail: "cto@example.test",
      actorName: "CTO",
      actorRole: "cto",
      justification: OVERRIDE_INPUT.justification,
      metadata: OVERRIDE_INPUT.metadata
    });

    assert.equal(out.ok, false);
    assert.equal(out.error, "not_pending");
    assert.equal(await auditCount(release.id, "OVERRIDE_APPROVED"), 1);
  });
});
