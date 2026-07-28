"use strict";

/**
 * Unit coverage for shared gate evidence resolution.
 * Integration coverage for certified+snapshot merge blocking lives in certifiedGateSnapshot.test.js.
 */

require("./helpers/backendFixtures");

const { describe, it, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");

const certificationSnapshots = require("../src/services/certificationSnapshots");
const workspaceConfig = require("../src/services/workspaceConfig");
const verdictEngine = require("../src/services/verdictEngine");
const {
  resolveGateEvidence,
  isCertifiedSnapshotMissing,
  attachSnapshotMeta
} = require("../src/services/gateContext");

describe("resolveGateEvidence", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("prefers frozen snapshot maps when present", async () => {
    mock.method(certificationSnapshots, "getCertificationSnapshot", async () => ({
      threshold_map: { accuracy: { min: 99 } },
      signal_map: { accuracy: 100 },
      frozen_at: "2026-01-01T00:00:00.000Z",
      evidence_hash: "abc"
    }));
    mock.method(workspaceConfig, "getThresholdMap", async () => {
      throw new Error("live thresholds must not be read when snapshot exists");
    });
    mock.method(verdictEngine, "getLatestSignalMap", async () => {
      throw new Error("live signals must not be read when snapshot exists");
    });

    const evidence = await resolveGateEvidence({ id: "rel_1", workspace_id: "ws_1", status: "CERTIFIED" });
    assert.equal(evidence.source, "snapshot");
    assert.deepEqual(evidence.thresholdMap, { accuracy: { min: 99 } });
    assert.deepEqual(evidence.latest, { accuracy: 100 });
    assert.ok(evidence.snapshot);
    assert.equal(isCertifiedSnapshotMissing({ status: "CERTIFIED" }, evidence), false);
  });

  it("falls back to live maps when snapshot is absent", async () => {
    mock.method(certificationSnapshots, "getCertificationSnapshot", async () => null);
    mock.method(workspaceConfig, "getThresholdMap", async () => ({ accuracy: { min: 85 } }));
    mock.method(verdictEngine, "getLatestSignalMap", async () => ({ accuracy: 90 }));

    const evidence = await resolveGateEvidence({ id: "rel_2", workspace_id: "ws_1", status: "COLLECTING" });
    assert.equal(evidence.source, "live");
    assert.equal(evidence.snapshot, null);
    assert.deepEqual(evidence.thresholdMap, { accuracy: { min: 85 } });
    assert.deepEqual(evidence.latest, { accuracy: 90 });
    assert.equal(isCertifiedSnapshotMissing({ status: "COLLECTING" }, evidence), false);
    assert.equal(isCertifiedSnapshotMissing({ status: "CERTIFIED" }, evidence), true);
    assert.equal(isCertifiedSnapshotMissing({ status: "CERTIFIED_WITH_OVERRIDE" }, evidence), true);
  });

  it("attachSnapshotMeta copies frozen fields onto certification payloads", () => {
    const payload = { summary: "ok" };
    attachSnapshotMeta(payload, {
      frozen_at: "2026-01-02T00:00:00.000Z",
      evidence_hash: "deadbeef"
    });
    assert.equal(payload.frozen_at, "2026-01-02T00:00:00.000Z");
    assert.equal(payload.evidence_hash, "deadbeef");
    assert.equal(attachSnapshotMeta(null, { frozen_at: "x" }), null);
  });
});
