"use strict";

require("./helpers/backendFixtures");

const crypto = require("crypto");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { run } = require("../src/database");
const engine = require("@useverdikt/shared/verdictEngine");
const { analyzeReleaseDeltas } = require("../src/services/delta");
const { computeVerdict } = require("../src/services/verdictEngine");
const { seedDefaultThresholdsForTest } = require("./helpers/backendFixtures");

const { evaluateFrozenEvidence, recordedStatusAgrees, computeEvidenceHash } = engine;

const required = (bounds) => ({ ...bounds, required_for_certification: true });

describe("evaluateFrozenEvidence: absolute thresholds", () => {
  it("treats a floor as inclusive: value == min passes, value just below fails", () => {
    const thresholds = { accuracy: required({ min: 85, max: null }) };
    assert.equal(evaluateFrozenEvidence({ accuracy: 85 }, thresholds).engine_status, "CERTIFIED");

    const below = evaluateFrozenEvidence({ accuracy: 84.99 }, thresholds);
    assert.equal(below.engine_status, "UNCERTIFIED");
    assert.deepEqual(below.failed_signals, [
      { signal_id: "accuracy", value: 84.99, failure_kind: "absolute_threshold", rule: ">= 85" }
    ]);
  });

  it("treats a ceiling as inclusive: value == max passes, value just above fails", () => {
    const thresholds = { p95latency: required({ min: null, max: 300 }) };
    assert.equal(evaluateFrozenEvidence({ p95latency: 300 }, thresholds).engine_status, "CERTIFIED");

    const above = evaluateFrozenEvidence({ p95latency: 300.01 }, thresholds);
    assert.equal(above.engine_status, "UNCERTIFIED");
    assert.deepEqual(above.failed_signals, [
      { signal_id: "p95latency", value: 300.01, failure_kind: "absolute_threshold", rule: "<= 300" }
    ]);
  });

  it("enforces both sides of a band", () => {
    const thresholds = { tone: required({ min: 10, max: 20 }) };
    assert.equal(evaluateFrozenEvidence({ tone: 15 }, thresholds).engine_status, "CERTIFIED");
    assert.deepEqual(
      evaluateFrozenEvidence({ tone: 9 }, thresholds).failed_signals.map((f) => f.rule),
      [">= 10"]
    );
    assert.deepEqual(
      evaluateFrozenEvidence({ tone: 21 }, thresholds).failed_signals.map((f) => f.rule),
      ["<= 20"]
    );
  });

  it("reports every failing required signal, not just the first", () => {
    const out = evaluateFrozenEvidence(
      { accuracy: 10, safety: 20, tone: 95 },
      {
        accuracy: required({ min: 85 }),
        safety: required({ min: 90 }),
        tone: required({ min: 85 })
      }
    );
    assert.equal(out.engine_status, "UNCERTIFIED");
    assert.deepEqual(out.failed_signals.map((f) => f.signal_id).sort(), ["accuracy", "safety"]);
  });

  it("ignores thresholds that are not required for certification", () => {
    const out = evaluateFrozenEvidence({ accuracy: 1 }, { accuracy: { min: 85, required_for_certification: false } });
    assert.equal(out.engine_status, "CERTIFIED");
    assert.deepEqual(out.failed_signals, []);
  });

  it("does not treat a missing signal as a threshold failure (missing is gated separately)", () => {
    const out = evaluateFrozenEvidence({}, { accuracy: required({ min: 85 }) });
    assert.equal(out.engine_status, "CERTIFIED");
    assert.deepEqual(out.failed_signals, []);
  });

  it("skips *_delta thresholds even when a same-named signal value exists", () => {
    const out = evaluateFrozenEvidence({ accuracy_delta: 50 }, { accuracy_delta: required({ min: 5, max: 5 }) });
    assert.equal(out.engine_status, "CERTIFIED");
  });

  it("treats a zero value as present (0 below a floor fails)", () => {
    const out = evaluateFrozenEvidence({ safety: 0 }, { safety: required({ min: 90 }) });
    assert.equal(out.engine_status, "UNCERTIFIED");
    assert.equal(out.failed_signals[0].value, 0);
  });
});

describe("recordedStatusAgrees", () => {
  const cases = [
    ["CERTIFIED", "CERTIFIED", true],
    ["CERTIFIED", "UNCERTIFIED", false],
    ["UNCERTIFIED", "UNCERTIFIED", true],
    ["UNCERTIFIED", "CERTIFIED", false],
    // An override is only legitimate when the engine said UNCERTIFIED.
    ["CERTIFIED_WITH_OVERRIDE", "UNCERTIFIED", true],
    ["CERTIFIED_WITH_OVERRIDE", "CERTIFIED", false],
    ["CERTIFICATION_REVOKED", "CERTIFIED", true],
    ["CERTIFICATION_REVOKED", "UNCERTIFIED", true],
    ["COLLECTING", "CERTIFIED", false],
    ["", "CERTIFIED", false],
    ["certified", "certified", true]
  ];
  for (const [recorded, engineStatus, expected] of cases) {
    it(`${recorded || "<empty>"} vs engine ${engineStatus} → ${expected}`, () => {
      assert.equal(recordedStatusAgrees(recorded, engineStatus), expected);
    });
  }
});

describe("computeEvidenceHash", () => {
  it("is independent of key order at every depth", () => {
    const a = computeEvidenceHash(
      { accuracy: { min: 85, max: null, required_for_certification: true }, safety: { min: 90 } },
      { accuracy: 91, safety: 95 }
    );
    const b = computeEvidenceHash(
      { safety: { min: 90 }, accuracy: { required_for_certification: true, max: null, min: 85 } },
      { safety: 95, accuracy: 91 }
    );
    assert.equal(a, b);
  });

  it("changes when any threshold bound, requirement flag or signal value changes", () => {
    const base = computeEvidenceHash({ accuracy: required({ min: 85 }) }, { accuracy: 91 });
    const variants = [
      computeEvidenceHash({ accuracy: required({ min: 86 }) }, { accuracy: 91 }),
      computeEvidenceHash({ accuracy: { min: 85, required_for_certification: false } }, { accuracy: 91 }),
      computeEvidenceHash({ accuracy: required({ min: 85 }) }, { accuracy: 91.0001 }),
      computeEvidenceHash({ accuracy: required({ min: 85 }) }, { accuracy: 91, safety: 1 })
    ];
    for (const v of variants) assert.notEqual(v, base);
    assert.equal(new Set(variants).size, variants.length);
  });

  it("binds signals and thresholds to their role (swapping them changes the hash)", () => {
    const x = { accuracy: 1 };
    const y = { accuracy: 2 };
    assert.notEqual(computeEvidenceHash(x, y), computeEvidenceHash(y, x));
  });
});

describe("shared verdict engine: ESM and CJS builds agree", () => {
  // The browser imports the .mjs build and the backend the .cjs build; any drift
  // means the UI and the server can disagree about the same evidence.
  function generatedCases() {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const ids = ["accuracy", "safety", "p95latency", "accuracy_delta", "custom_metric"];
    const cases = [];
    for (let i = 0; i < 200; i += 1) {
      const thresholds = {};
      const signals = {};
      for (const id of ids) {
        if (rand() < 0.8) {
          thresholds[id] = {
            min: rand() < 0.5 ? Math.round(rand() * 100) : null,
            max: rand() < 0.4 ? Math.round(rand() * 400) : null,
            required_for_certification: rand() < 0.7
          };
        }
        if (rand() < 0.85) signals[id] = Math.round(rand() * 40000) / 100;
      }
      cases.push({ thresholds, signals });
    }
    return cases;
  }

  it("produces identical verdicts, failures and evidence hashes", async () => {
    const esm = await import("@useverdikt/shared/verdictEngine");
    assert.equal(esm.ENGINE_VERSION, engine.ENGINE_VERSION);
    assert.equal(esm.CERT_BUNDLE_SCHEMA, engine.CERT_BUNDLE_SCHEMA);
    let uncertified = 0;
    for (const { thresholds, signals } of generatedCases()) {
      const cjsOut = engine.evaluateFrozenEvidence(signals, thresholds);
      assert.deepEqual(esm.evaluateFrozenEvidence(signals, thresholds), cjsOut);
      assert.equal(esm.computeEvidenceHash(thresholds, signals), engine.computeEvidenceHash(thresholds, signals));
      if (cjsOut.engine_status === "UNCERTIFIED") uncertified += 1;
    }
    for (const rec of ["CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE", "CERTIFICATION_REVOKED", "COLLECTING"]) {
      for (const eng of ["CERTIFIED", "UNCERTIFIED"]) {
        assert.equal(esm.recordedStatusAgrees(rec, eng), engine.recordedStatusAgrees(rec, eng));
      }
    }
    // Guard against a generator that only ever exercises one branch.
    assert.ok(uncertified > 20 && uncertified < 180, `uncertified cases: ${uncertified}`);
  });
});

describe("analyzeReleaseDeltas: regression against the last certified release", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const thresholds = { accuracy_delta: { min: 5 } };

  async function seedRelease(ws, { status, ageDays, accuracy }) {
    const id = `rel_delta_${crypto.randomBytes(5).toString("hex")}`;
    const at = new Date(Date.now() - ageDays * DAY).toISOString();
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
       VALUES ($1, $2, $1, 'model_update', 'pre-prod', $3, $4, $4)`,
      [id, ws, status, at]
    );
    if (accuracy != null) {
      await run(
        "INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'accuracy', $2, 't', $3)",
        [id, accuracy, at]
      );
    }
    return { id, created_at: at };
  }

  const newWorkspace = () => `ws_delta_${crypto.randomBytes(5).toString("hex")}`;

  async function analyze(ws, current, accuracy) {
    return analyzeReleaseDeltas({
      workspaceId: ws,
      releaseId: current.id,
      releaseRow: current,
      latest: { accuracy },
      thresholdMap: thresholds
    });
  }

  it("passes a drop exactly equal to the allowed maximum and fails anything larger", async () => {
    const ws = newWorkspace();
    const base = await seedRelease(ws, { status: "CERTIFIED", ageDays: 3, accuracy: 90 });
    const current = await seedRelease(ws, { status: "COLLECTING", ageDays: 0 });

    const atLimit = await analyze(ws, current, 85);
    assert.equal(atLimit.baseline_release_id, base.id);
    assert.deepEqual(atLimit.failures, []);

    const over = await analyze(ws, current, 84.9);
    assert.equal(over.failures.length, 1);
    assert.equal(over.failures[0].failure_kind, "regression");
    assert.equal(over.failures[0].baseline_value, 90);
    assert.ok(Math.abs(over.failures[0].drop_amount - 5.1) < 1e-9);
  });

  it("never fails an improvement", async () => {
    const ws = newWorkspace();
    await seedRelease(ws, { status: "CERTIFIED", ageDays: 3, accuracy: 80 });
    const current = await seedRelease(ws, { status: "COLLECTING", ageDays: 0 });
    assert.deepEqual((await analyze(ws, current, 99)).failures, []);
  });

  it("uses the most recent earlier certified (or overridden) release as the baseline", async () => {
    const ws = newWorkspace();
    await seedRelease(ws, { status: "CERTIFIED", ageDays: 10, accuracy: 70 });
    const override = await seedRelease(ws, { status: "CERTIFIED_WITH_OVERRIDE", ageDays: 5, accuracy: 95 });
    await seedRelease(ws, { status: "UNCERTIFIED", ageDays: 2, accuracy: 60 });
    await seedRelease(ws, { status: "CERTIFICATION_REVOKED", ageDays: 1, accuracy: 60 });
    const current = await seedRelease(ws, { status: "COLLECTING", ageDays: 0 });
    await seedRelease(ws, { status: "CERTIFIED", ageDays: -1, accuracy: 50 });

    const out = await analyze(ws, current, 88);
    assert.equal(out.baseline_release_id, override.id);
    assert.equal(out.failures.length, 1, "95 → 88 exceeds the allowed drop of 5");
  });

  it("ignores certified releases from other workspaces", async () => {
    const ws = newWorkspace();
    await seedRelease(newWorkspace(), { status: "CERTIFIED", ageDays: 3, accuracy: 99 });
    const current = await seedRelease(ws, { status: "COLLECTING", ageDays: 0 });
    const out = await analyze(ws, current, 50);
    assert.equal(out.baseline_release_id, null);
    assert.equal(out.no_prior_certified_baseline, true);
    assert.deepEqual(out.failures, []);
  });

  it("does not compare signals that have no delta threshold", async () => {
    const ws = newWorkspace();
    await seedRelease(ws, { status: "CERTIFIED", ageDays: 3, accuracy: 99 });
    const current = await seedRelease(ws, { status: "COLLECTING", ageDays: 0 });
    const out = await analyzeReleaseDeltas({
      workspaceId: ws,
      releaseId: current.id,
      releaseRow: current,
      latest: { accuracy: 10 },
      thresholdMap: {}
    });
    assert.deepEqual(out.failures, []);
    assert.deepEqual(out.snapshot, []);
  });
});

describe("computeVerdict with workspace defaults", () => {
  it("fails a release that clears every absolute floor but regresses past the delta limit", async () => {
    const ws = `ws_verdict_delta_${crypto.randomBytes(5).toString("hex")}`;
    await seedDefaultThresholdsForTest(ws);
    const DAY = 24 * 60 * 60 * 1000;
    const baseAt = new Date(Date.now() - 3 * DAY).toISOString();
    const curAt = new Date().toISOString();
    const baseId = `rel_vd_base_${crypto.randomBytes(4).toString("hex")}`;
    const curId = `rel_vd_cur_${crypto.randomBytes(4).toString("hex")}`;
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
       VALUES ($1, $2, 'v0', 'model_update', 'pre-prod', 'CERTIFIED', $3, $3)`,
      [baseId, ws, baseAt]
    );
    await run(
      "INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, 'accuracy', 99, 't', $2)",
      [baseId, baseAt]
    );
    const passing = { accuracy: 92, safety: 95, tone: 90, hallucination: 95, relevance: 85 };

    const noBaseline = await computeVerdict(ws, curId, passing, null);
    assert.equal(noBaseline.status, "CERTIFIED");

    const withBaseline = await computeVerdict(ws, curId, passing, { id: curId, created_at: curAt });
    assert.equal(withBaseline.status, "UNCERTIFIED");
    assert.deepEqual(
      withBaseline.failed_signals.map((f) => [f.signal_id, f.failure_kind]),
      [["accuracy", "regression"]]
    );
  });

  it("reports the default-floor failure for a below-floor AI signal", async () => {
    const ws = `ws_verdict_floor_${crypto.randomBytes(5).toString("hex")}`;
    await seedDefaultThresholdsForTest(ws);
    const out = await computeVerdict(
      ws,
      "rel_unused",
      { accuracy: 84, safety: 90, tone: 85, hallucination: 90, relevance: 82 },
      null
    );
    assert.equal(out.status, "UNCERTIFIED");
    assert.deepEqual(
      out.failed_signals.map((f) => [f.signal_id, f.rule]),
      [["accuracy", ">= 85"]]
    );
  });
});
