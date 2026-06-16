/**
 * Behavioral tests for formatGateForAgent.
 * Uses node:test (built-in, Node ≥18) — no extra dependencies.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatGateForAgent } from "./gateFormat.js";

// ── merge action ──────────────────────────────────────────────────────────────

test("merge action: sets action and correct next_step", () => {
  const out = formatGateForAgent({ action: "merge", gate: { exit_code: 0 } });
  assert.equal(out.agent_guidance.action, "merge");
  assert.ok(out.agent_guidance.next_step.includes("Merge/deploy allowed"));
  assert.equal(out.agent_guidance.read_field, "action");
});

test("merge action: certification passed through when present", () => {
  const cert = { summary: "All signals passed", passed_signals: [], confidence: 0.9, risk_level: "LOW" };
  const out = formatGateForAgent({ action: "merge", certification: cert, gate: { exit_code: 0 } });
  assert.deepEqual(out.certification, cert);
  assert.deepEqual(out.agent_guidance.certification, cert);
  assert.equal(out.remediation, null);
  assert.equal(out.agent_guidance.remediation, null);
});

// ── escalate action ───────────────────────────────────────────────────────────

test("escalate action: next_step references escalate tool", () => {
  const out = formatGateForAgent({ action: "escalate", gate: { exit_code: 1 }, blockers: [{ reason: "UNCERTIFIED" }] });
  assert.equal(out.agent_guidance.action, "escalate");
  assert.ok(out.agent_guidance.next_step.toLowerCase().includes("escalate"));
  assert.deepEqual(out.agent_guidance.blockers, [{ reason: "UNCERTIFIED" }]);
});

test("escalate action: remediation passed through when present", () => {
  const remed = { summary: "accuracy below threshold", failures: [{ signal_id: "accuracy" }], suggested_actions: ["re-run evals"] };
  const out = formatGateForAgent({ action: "escalate", remediation: remed, gate: { exit_code: 1 } });
  assert.deepEqual(out.remediation, remed);
  assert.deepEqual(out.agent_guidance.remediation, remed);
  assert.equal(out.certification, null);
  assert.equal(out.agent_guidance.certification, null);
});

// ── self_heal action ──────────────────────────────────────────────────────────

test("self_heal action: next_step references remediation fields", () => {
  const out = formatGateForAgent({ action: "self_heal", gate: { exit_code: 1 } });
  assert.equal(out.agent_guidance.action, "self_heal");
  assert.ok(out.agent_guidance.next_step.includes("remediation"));
});

// ── collecting action ─────────────────────────────────────────────────────────

test("collecting action: next_step tells agent to poll", () => {
  const out = formatGateForAgent({ action: "collecting", gate: { exit_code: 1 } });
  assert.ok(out.agent_guidance.next_step.toLowerCase().includes("poll"));
});

// ── safety guarantees ─────────────────────────────────────────────────────────

test("do_not_use_exit_code_alone is always present", () => {
  for (const action of ["merge", "escalate", "self_heal", "collecting"]) {
    const out = formatGateForAgent({ action, gate: { exit_code: 0 } });
    assert.ok(typeof out.agent_guidance.do_not_use_exit_code_alone === "string");
  }
});

test("unknown action falls back gracefully", () => {
  const out = formatGateForAgent({ action: "unknown_future_action", gate: { exit_code: 1 } });
  assert.equal(out.agent_guidance.action, "unknown_future_action");
  assert.ok(typeof out.agent_guidance.next_step === "string");
});

test("null input does not throw", () => {
  const out = formatGateForAgent(null);
  assert.equal(out.agent_guidance.action, "unknown");
});

test("calibration passed through to agent_guidance when present", () => {
  const cal = {
    summary: "1 pending prod calibration suggestion on Thresholds.",
    pending_suggestions_count: 1,
    mode: "suggest_only"
  };
  const out = formatGateForAgent({ action: "merge", calibration: cal, gate: { exit_code: 0 } });
  assert.deepEqual(out.calibration, cal);
  assert.deepEqual(out.agent_guidance.calibration, cal);
});

test("original fields from gate response are preserved", () => {
  const input = { action: "merge", release_id: "rel_abc", workspace_id: "ws_1", can_merge: true, gate: { exit_code: 0 } };
  const out = formatGateForAgent(input);
  assert.equal(out.release_id, "rel_abc");
  assert.equal(out.workspace_id, "ws_1");
  assert.equal(out.can_merge, true);
});
