"use strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const crypto = require("crypto");
const { before, afterEach, describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");

const { initDatabase, queryOne, queryAll, run } = require("../src/database");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { runCollectionDeadlineSweep } = require("../src/jobs/collectionSweep");
const { claimDueCollectionReleases } = require("../src/services/collectionSweepClaims");
const { claimDueVcsMonitoringWindows } = require("../src/services/vcsMonitorSweepClaims");
const { evaluateReleaseAfterSignalIngest } = require("../src/services/domain");
const { applyReleaseOverride } = require("../src/services/releaseOverride");
const certificationSnapshots = require("../src/services/certificationSnapshots");
const vcsMonitor = require("../src/services/vcsMonitor");
const { setVcsIntegration } = require("../src/services/vcsWriteback");
const { nowIso } = require("../src/lib/time");

const originalFetch = global.fetch;
const quiet = { logFn: () => {}, incFn: () => {} };

before(async () => {
  await initDatabase();
});

afterEach(() => {
  mock.restoreAll();
  global.fetch = originalFetch;
});

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

async function seedRelease({ status = "COLLECTING", environment = "staging", deadline = minutesAgo(5) } = {}) {
  const workspaceId = `ws_sweep_${crypto.randomBytes(4).toString("hex")}`;
  const releaseId = `rel_sweep_${crypto.randomBytes(5).toString("hex")}`;
  await ensureWorkspaceSeeded(workspaceId);
  const ts = nowIso();
  await run(
    `INSERT INTO releases
       (id, workspace_id, version, release_type, environment, status, created_at, updated_at,
        collection_deadline, commit_sha)
     VALUES ($1, $2, 'sweep-v1', 'model_update', $3, $4, $5, $5, $6, $7)`,
    [releaseId, workspaceId, environment, status, ts, deadline, crypto.randomBytes(20).toString("hex")]
  );
  return queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
}

async function seedWindow(release, { status = "pending", start = minutesAgo(10), minutes = 120, scanCount = 0 } = {}) {
  await run(
    `INSERT INTO vcs_monitoring_windows
       (release_id, workspace_id, commit_sha, pr_number, monitoring_start, monitoring_end,
        window_minutes, status, last_scanned_at, scan_count, created_at)
     VALUES ($1, $2, $3, 12, $4, $5, $6, $7, NULL, $8, $4)`,
    [
      release.id,
      release.workspace_id,
      release.commit_sha,
      start,
      new Date(Date.parse(start) + minutes * 60_000).toISOString(),
      minutes,
      status,
      scanCount
    ]
  );
  return vcsMonitor.getMonitoringWindow(release.id);
}

describe("sweep guarantees (#327)", () => {
  it("C1: two observe-mode sweeps that loaded the same release commit one verdict", async () => {
    const release = await seedRelease();
    const staleBatch = async () => [release];
    await runCollectionDeadlineSweep({ claimMode: "observe", queryAllFn: staleBatch, ...quiet });
    await runCollectionDeadlineSweep({ claimMode: "observe", queryAllFn: staleBatch, ...quiet });
    const commits = await queryAll(
      `SELECT id FROM audit_events
        WHERE release_id = $1 AND event_type = 'SIGNALS_INGESTED'
          AND details_json::jsonb->>'computed_status' = 'UNCERTIFIED'`,
      [release.id]
    );
    assert.equal(commits.length, 1);
  });

  it("C2: a collection claim that keeps failing is parked at the attempt cap", async () => {
    const release = await seedRelease();
    await run(
      `INSERT INTO collection_sweep_claims
         (release_id, workspace_id, claimed_by, claimed_at, lease_until, attempt_count, last_error, updated_at)
       VALUES ($1, $2, 'dead', NOW(), NOW() - INTERVAL '1 second', 10, 'boom', NOW())`,
      [release.id, release.workspace_id]
    );
    const claimed = await claimDueCollectionReleases({
      workerId: "fresh",
      workspaceId: release.workspace_id,
      maxAttempts: 10
    });
    assert.equal(claimed.length, 0);
  });

  it("C2/V3: a VCS claim that keeps failing is parked at the attempt cap", async () => {
    const release = await seedRelease({ status: "CERTIFIED", environment: "prod" });
    await seedWindow(release);
    await run(
      `INSERT INTO vcs_monitor_sweep_claims
         (release_id, workspace_id, claimed_by, claimed_at, lease_until, attempt_count, last_error, updated_at)
       VALUES ($1, $2, 'dead', NOW(), NOW() - INTERVAL '1 second', 10, 'boom', NOW())`,
      [release.id, release.workspace_id]
    );
    const claimed = await claimDueVcsMonitoringWindows({
      workerId: "fresh",
      workspaceId: release.workspace_id,
      maxAttempts: 10
    });
    assert.equal(claimed.length, 0);
  });

  it("V1: a scan that finishes after a prod promotion does not overwrite the refreshed window", async () => {
    const release = await seedRelease({ status: "CERTIFIED", environment: "prod" });
    const stale = await seedWindow(release, { start: minutesAgo(30) });
    await vcsMonitor.refreshMonitoringWindowForProd(release);
    const result = await vcsMonitor.scanWindow(stale);
    const window = await vcsMonitor.getMonitoringWindow(release.id);
    assert.equal(window.status, "pending");
    assert.equal(result, "superseded");
  });

  it("V2: ingest keys differ per window start and per interim scan", () => {
    const base = { release_id: "rel_1", monitoring_start: "2026-11-16T10:00:00.000Z", scan_count: 0 };
    const keys = new Set([
      vcsMonitor.vcsIngestKey(base, false),
      vcsMonitor.vcsIngestKey({ ...base, scan_count: 1 }, false),
      vcsMonitor.vcsIngestKey(base, true),
      vcsMonitor.vcsIngestKey({ ...base, monitoring_start: "2026-11-16T12:00:00.000Z" }, true)
    ]);
    assert.equal(keys.size, 4);
  });

  it("V3: retryable provider failures on a closed window stop at the scan cap", async () => {
    const release = await seedRelease({ status: "CERTIFIED", environment: "prod" });
    await setVcsIntegration(release.workspace_id, {
      provider: "github",
      access_token: "not-a-real-token",
      owner: "useverdikt",
      repo: "Verdikt"
    });
    const window = await seedWindow(release, { start: minutesAgo(180), scanCount: 47 });
    global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const status = await vcsMonitor.scanWindow(window);
    const stored = await vcsMonitor.getMonitoringWindow(release.id);
    assert.equal(status, "error");
    assert.equal(stored.status, "error");
    assert.match(stored.error_message, /retry limit reached/);
  });

  it("V4: connecting a VCS integration reopens no_vcs and error windows", async () => {
    const a = await seedRelease({ status: "CERTIFIED", environment: "prod" });
    await seedWindow(a, { status: "no_vcs" });
    const b = await seedRelease({ status: "CERTIFIED", environment: "prod" });
    await run("UPDATE releases SET workspace_id = $1 WHERE id = $2", [a.workspace_id, b.id]);
    await seedWindow({ ...b, workspace_id: a.workspace_id }, { status: "error" });
    await setVcsIntegration(a.workspace_id, {
      provider: "github",
      access_token: "not-a-real-token",
      owner: "useverdikt",
      repo: "Verdikt"
    });
    assert.equal((await vcsMonitor.getMonitoringWindow(a.id)).status, "pending");
    assert.equal((await vcsMonitor.getMonitoringWindow(b.id)).status, "pending");
  });

  it("S2: a verdict never commits without its certification snapshot", async () => {
    const release = await seedRelease();
    mock.method(certificationSnapshots, "persistCertificationSnapshot", async () => {
      throw new Error("snapshot write failed");
    });
    await evaluateReleaseAfterSignalIngest(release, release.id, "sweep_guarantees_test", 0).catch(() => null);
    const stored = await queryOne("SELECT status FROM releases WHERE id = $1", [release.id]);
    const snapshot = await queryOne("SELECT status_at_verdict FROM certification_snapshots WHERE release_id = $1", [release.id]);
    if (stored.status !== "COLLECTING") {
      assert.equal(snapshot?.status_at_verdict, stored.status, "verdict committed without its snapshot");
    }
  });

  it("S3: an override never commits with the pre-override snapshot", async () => {
    const release = await seedRelease({ status: "COLLECTING" });
    await evaluateReleaseAfterSignalIngest(release, release.id, "sweep_guarantees_test", 0);
    const uncertified = await queryOne("SELECT * FROM releases WHERE id = $1", [release.id]);
    assert.equal(uncertified.status, "UNCERTIFIED");
    mock.method(certificationSnapshots, "persistCertificationSnapshot", async () => {
      throw new Error("snapshot write failed");
    });
    await applyReleaseOverride(uncertified, {
      approver_name: "Pat",
      approver_role: "vp_engineering",
      justification: "Known flaky eval, approved for staging",
      metadata: {
        impact_summary: "staging only impact",
        mitigation_plan: "rerun the eval suite",
        follow_up_due_date: "2026-12-01"
      }
    }).catch(() => null);
    const stored = await queryOne("SELECT status FROM releases WHERE id = $1", [release.id]);
    const snapshot = await queryOne("SELECT status_at_verdict FROM certification_snapshots WHERE release_id = $1", [release.id]);
    if (stored.status === "CERTIFIED_WITH_OVERRIDE") {
      assert.equal(snapshot?.status_at_verdict, "CERTIFIED_WITH_OVERRIDE", "override committed with the old snapshot");
    }
  });
});

describe("sweep regression guards", () => {
  it("a claim below the attempt cap with an expired lease is still reclaimed", async () => {
    const release = await seedRelease();
    await run(
      `INSERT INTO collection_sweep_claims
         (release_id, workspace_id, claimed_by, claimed_at, lease_until, attempt_count, last_error, updated_at)
       VALUES ($1, $2, 'dead', NOW(), NOW() - INTERVAL '1 second', 3, 'boom', NOW())`,
      [release.id, release.workspace_id]
    );
    const claimed = await claimDueCollectionReleases({ workerId: "fresh", workspaceId: release.workspace_id });
    assert.deepEqual(claimed.map((r) => r.id), [release.id]);
  });

  it("a scan of the current window still records its result", async () => {
    const release = await seedRelease({ status: "CERTIFIED", environment: "prod" });
    const window = await seedWindow(release);
    const status = await vcsMonitor.scanWindow(window);
    assert.equal(status, "no_vcs");
    assert.equal((await vcsMonitor.getMonitoringWindow(release.id)).status, "no_vcs");
  });

  it("the verdict path still writes the snapshot", async () => {
    const release = await seedRelease();
    const result = await evaluateReleaseAfterSignalIngest(release, release.id, "sweep_guarantees_test", 0);
    assert.equal(result.status, "UNCERTIFIED");
    const snapshot = await queryOne("SELECT status_at_verdict FROM certification_snapshots WHERE release_id = $1", [release.id]);
    assert.equal(snapshot.status_at_verdict, "UNCERTIFIED");
  });
});
