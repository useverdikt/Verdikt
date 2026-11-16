"use strict";

process.env.NODE_ENV = "test";
process.env.OUTBOX_MODE = "shadow";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const crypto = require("crypto");
const { before, afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { initDatabase, queryOne, queryAll, run, transaction } = require("../src/database");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { enqueuePostVerdictOutbox } = require("../src/services/outboundEffectOutbox");
const {
  claimDueOutboundEffects,
  retryOrDeadLetter
} = require("../src/services/outboundEffectShadowWorker");
const {
  deliverPrimaryEffect,
  releaseForRow,
  processDueOutboundPrimaryEffects
} = require("../src/services/outboundEffectPrimaryWorker");
const { deliverReleaseCallback } = require("../src/services/releaseCallback");
const { nowIso } = require("../src/lib/time");

const workspacesToClean = new Set();
const quiet = { logFn: () => {}, incFn: () => {} };

before(async () => {
  await initDatabase();
});

afterEach(async () => {
  for (const workspaceId of workspacesToClean) {
    await run("DELETE FROM outbound_effect_outbox WHERE workspace_id = $1", [workspaceId]);
    await run("DELETE FROM releases WHERE workspace_id = $1", [workspaceId]);
  }
  workspacesToClean.clear();
});

async function seedRelease() {
  const workspaceId = `ws_obx_${crypto.randomBytes(4).toString("hex")}`;
  const releaseId = `rel_obx_${crypto.randomBytes(5).toString("hex")}`;
  const timestamp = nowIso();
  workspacesToClean.add(workspaceId);
  await ensureWorkspaceSeeded(workspaceId);
  await run(
    `INSERT INTO releases
       (id, workspace_id, version, release_type, environment, status, created_at, updated_at,
        verdict_issued_at, commit_sha, pr_number)
     VALUES ($1, $2, 'obx-v1', 'model_update', 'staging', 'CERTIFIED', $3, $3, $3, $4, 9)`,
    [releaseId, workspaceId, timestamp, crypto.randomBytes(20).toString("hex")]
  );
  return { workspaceId, releaseId, timestamp };
}

function enqueue(release, { mode = "primary", effectTypes = ["release_callback"], occurrence = null, verdictStatus = "CERTIFIED" } = {}) {
  return transaction((tx) =>
    enqueuePostVerdictOutbox({
      tx,
      releaseId: release.releaseId,
      workspaceId: release.workspaceId,
      verdictStatus,
      verdictIssuedAt: release.timestamp,
      triggerSource: "outbox_guarantees_test",
      mode,
      effectTypes,
      occurrence
    })
  );
}

function outboxRows(release) {
  return queryAll(
    "SELECT * FROM outbound_effect_outbox WHERE release_id = $1 ORDER BY created_at, id",
    [release.releaseId]
  );
}

function exhaustedAudits(release) {
  return queryAll(
    "SELECT event_type FROM audit_events WHERE release_id = $1 AND event_type LIKE 'OUTBOUND_EFFECT_%_EXHAUSTED'",
    [release.releaseId]
  );
}

describe("outbox delivery guarantees (#326)", () => {
  it("O1: an overlapping batch that reclaims an expired lease is the only one that sends", async () => {
    const release = await seedRelease();
    await enqueue(release);
    let sends = 0;
    const innerSummaries = [];

    const outer = await processDueOutboundPrimaryEffects({
      workerId: "same-process",
      workspaceId: release.workspaceId,
      ...quiet,
      deliverFn: async (row, { beforeSend }) => {
        await run("UPDATE outbound_effect_outbox SET claimed_until = NOW() - INTERVAL '1 second' WHERE id = $1", [row.id]);
        innerSummaries.push(
          await processDueOutboundPrimaryEffects({
            workerId: "same-process",
            workspaceId: release.workspaceId,
            ...quiet,
            deliverFn: async (_row, inner) => {
              if (await inner.beforeSend()) sends += 1;
              return { outcome: "delivered" };
            }
          })
        );
        if (await beforeSend()) sends += 1;
        return { outcome: "delivered" };
      }
    });

    assert.equal(sends, 1, "exactly one network send");
    assert.equal(innerSummaries[0].delivered, 1);
    assert.equal(outer.delivered, 0, "the stale batch must not report a delivery");
    const [row] = await outboxRows(release);
    assert.equal(row.state, "delivered");
  });

  it("O2: a worker that lost the lease neither changes the row nor writes an exhausted audit", async () => {
    const release = await seedRelease();
    await enqueue(release);
    const [claimed] = await claimDueOutboundEffects({
      workerId: "owner-a",
      workspaceId: release.workspaceId,
      deliveryMode: "primary"
    });
    const audits = [];
    const state = await retryOrDeadLetter({ ...claimed, attempt_count: 99 }, "owner-b", new Error("boom"), {
      maxAttempts: 1,
      auditFn: async (entry) => audits.push(entry)
    });
    assert.equal(state, "ownership_lost");
    assert.equal(audits.length, 0);
    const [row] = await outboxRows(release);
    assert.equal(row.state, "processing");
    assert.equal(row.claimed_by, "owner-a");
  });

  it("O3: a row whose worker keeps dying is dead-lettered at the attempt cap instead of reclaimed forever", async () => {
    const release = await seedRelease();
    await enqueue(release, { mode: "shadow", effectTypes: ["vcs_writeback"] });
    await run(
      `UPDATE outbound_effect_outbox
          SET state = 'processing', claimed_by = 'dead-worker', attempt_count = 3,
              claimed_until = NOW() - INTERVAL '1 second'
        WHERE release_id = $1`,
      [release.releaseId]
    );
    const claimed = await claimDueOutboundEffects({
      workerId: "fresh",
      workspaceId: release.workspaceId,
      maxAttempts: 3
    });
    assert.equal(claimed.length, 0);
    const [row] = await outboxRows(release);
    assert.equal(row.state, "dead_letter");
    assert.deepEqual((await exhaustedAudits(release)).map((a) => a.event_type), ["OUTBOUND_EFFECT_SHADOW_EXHAUSTED"]);
  });

  it("O4: a release without a callback URL is skipped, not reported as a failed delivery", async () => {
    const result = await deliverReleaseCallback({ id: "rel_x", workspace_id: "ws_x", callback_url: null }, null);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_callback_url");
  });

  it("O5: a failure after the send started is dead-lettered once, never retried", async () => {
    const release = await seedRelease();
    await enqueue(release);
    let sends = 0;
    const summary = await processDueOutboundPrimaryEffects({
      workerId: "w",
      workspaceId: release.workspaceId,
      ...quiet,
      deliverFn: async (_row, { beforeSend }) => {
        if (await beforeSend()) sends += 1;
        throw new Error("socket hang up");
      }
    });
    assert.equal(sends, 1);
    assert.equal(summary.retried, 0);
    assert.equal(summary.dead_lettered, 1);
    const [row] = await outboxRows(release);
    assert.equal(row.state, "dead_letter");
    assert.ok(row.delivery_started_at);
  });

  it("O5: a worker that crashed mid-send leaves a row the next claim dead-letters instead of re-sending", async () => {
    const release = await seedRelease();
    await enqueue(release);
    await run(
      `UPDATE outbound_effect_outbox
          SET state = 'processing', claimed_by = 'crashed', attempt_count = 1,
              delivery_started_at = NOW() - INTERVAL '2 minutes',
              claimed_until = NOW() - INTERVAL '1 second'
        WHERE release_id = $1`,
      [release.releaseId]
    );
    const claimed = await claimDueOutboundEffects({
      workerId: "fresh",
      workspaceId: release.workspaceId,
      deliveryMode: "primary"
    });
    assert.equal(claimed.length, 0);
    const [row] = await outboxRows(release);
    assert.equal(row.state, "dead_letter");
    assert.match(row.last_error, /delivery outcome unknown/);
    assert.deepEqual((await exhaustedAudits(release)).map((a) => a.event_type), ["OUTBOUND_EFFECT_PRIMARY_EXHAUSTED"]);
  });

  it("O6: delivery uses the verdict on the row, not the release's later status", () => {
    const delivered = releaseForRow(
      { id: "rel", status: "REVOKED", verdict_issued_at: "2026-11-16T10:00:00.000Z" },
      { verdict_status: "CERTIFIED", verdict_issued_at: "2026-11-16T09:00:00.000Z" }
    );
    assert.equal(delivered.status, "CERTIFIED");
    assert.equal(delivered.verdict_issued_at, "2026-11-16T09:00:00.000Z");
  });

  it("O6: an older verdict retried after a newer one was delivered is skipped", async () => {
    const release = await seedRelease();
    await enqueue(release, { verdictStatus: "UNCERTIFIED" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await enqueue(release, { verdictStatus: "CERTIFIED", occurrence: nowIso() });
    const [older, newer] = await outboxRows(release);
    await run("UPDATE outbound_effect_outbox SET state = 'delivered', delivered_at = NOW() WHERE id = $1", [newer.id]);
    let sent = false;
    const result = await deliverPrimaryEffect(older, {
      beforeSend: async () => {
        sent = true;
        return true;
      }
    });
    assert.equal(result.outcome, "skipped");
    assert.equal(result.reason, "superseded_by_newer_verdict");
    assert.equal(sent, false);
  });

  it("O8: rows are claimed only by the processor for the mode they were enqueued in", async () => {
    const release = await seedRelease();
    await enqueue(release, { mode: "shadow", effectTypes: ["vcs_writeback"] });
    await enqueue(release, { mode: "primary", effectTypes: ["outbound_webhook"] });
    const primary = await claimDueOutboundEffects({
      workerId: "p",
      workspaceId: release.workspaceId,
      deliveryMode: "primary"
    });
    const shadow = await claimDueOutboundEffects({
      workerId: "s",
      workspaceId: release.workspaceId,
      deliveryMode: "shadow"
    });
    assert.deepEqual(primary.map((r) => r.effect_type), ["outbound_webhook"]);
    assert.deepEqual(shadow.map((r) => r.effect_type), ["vcs_writeback"]);
  });

  it("O9: a re-evaluation with the same status enqueues a new primary row; shadow stays deduplicated", async () => {
    const release = await seedRelease();
    await enqueue(release, { mode: "primary" });
    const again = await enqueue(release, { mode: "primary", occurrence: new Date(Date.now() + 1000).toISOString() });
    assert.equal(again.inserted.length, 1);

    const other = await seedRelease();
    await enqueue(other, { mode: "shadow" });
    const shadowAgain = await enqueue(other, { mode: "shadow", occurrence: new Date(Date.now() + 1000).toISOString() });
    assert.equal(shadowAgain.inserted.length, 0);
  });
});

describe("outbox regression guards", () => {
  it("legacy rows with no stored mode are treated as shadow", async () => {
    const release = await seedRelease();
    await enqueue(release, { mode: "shadow", effectTypes: ["vcs_writeback"] });
    await run("UPDATE outbound_effect_outbox SET envelope_json = envelope_json - 'mode' WHERE release_id = $1", [release.releaseId]);
    const primary = await claimDueOutboundEffects({ workerId: "p", workspaceId: release.workspaceId, deliveryMode: "primary" });
    const shadow = await claimDueOutboundEffects({ workerId: "s", workspaceId: release.workspaceId });
    assert.equal(primary.length, 0);
    assert.equal(shadow.length, 1);
  });

  it("an expired lease below the attempt cap with no send started is still reclaimed", async () => {
    const release = await seedRelease();
    await enqueue(release);
    await run(
      `UPDATE outbound_effect_outbox
          SET state = 'processing', claimed_by = 'slow', attempt_count = 1,
              claimed_until = NOW() - INTERVAL '1 second'
        WHERE release_id = $1`,
      [release.releaseId]
    );
    const claimed = await claimDueOutboundEffects({ workerId: "fresh", workspaceId: release.workspaceId, deliveryMode: "primary" });
    assert.equal(claimed.length, 1);
    assert.equal(Number(claimed[0].attempt_count), 2);
    const stored = await queryOne("SELECT state FROM outbound_effect_outbox WHERE id = $1", [claimed[0].id]);
    assert.equal(stored.state, "processing");
  });
});
