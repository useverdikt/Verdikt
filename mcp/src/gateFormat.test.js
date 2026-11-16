/**
 * Behavioral tests for formatGateForAgent.
 * Uses node:test (built-in, Node ≥18) — no extra dependencies.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertGateCommitSha,
  formatGateForAgent,
  formatReleaseBriefForAgent
} from "./gateFormat.js";

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

test("recover_certification action: next_step references CERTIFIED recovery", () => {
  const out = formatGateForAgent({ action: "recover_certification", gate: { exit_code: 1 } });
  assert.equal(out.agent_guidance.action, "recover_certification");
  assert.ok(out.agent_guidance.next_step.toLowerCase().includes("certified"));
});

test("recover_certification action: snapshot_pending points at frozen evidence, not debt", () => {
  const out = formatGateForAgent({
    action: "recover_certification",
    snapshot_pending: true,
    gate: { exit_code: 1 }
  });
  assert.ok(out.agent_guidance.next_step.toLowerCase().includes("snapshot"));
  assert.equal(out.agent_guidance.next_step.toLowerCase().includes("remediation debt"), false);
});

test("recover_certification action: strict_mode blocker points at a clean certification, not debt", () => {
  const out = formatGateForAgent({
    action: "recover_certification",
    blockers: [{ type: "strict_mode" }],
    gate: { exit_code: 1 }
  });
  assert.ok(out.agent_guidance.next_step_legacy.toLowerCase().includes("strict"));
  assert.equal(out.agent_guidance.next_step_legacy.toLowerCase().includes("remediation debt"), false);
});

test("escalate action: prod_locked blocker explains signals cannot change the verdict", () => {
  const out = formatGateForAgent({
    action: "escalate",
    blockers: [{ type: "prod_locked" }],
    gate: { exit_code: 1 }
  });
  assert.ok(out.agent_guidance.next_step_legacy.toLowerCase().includes("locked"));
});

// ── collecting action ─────────────────────────────────────────────────────────

test("collecting action: next_step tells agent to poll", () => {
  const out = formatGateForAgent({ action: "collecting", gate: { exit_code: 1 } });
  assert.ok(out.agent_guidance.next_step.toLowerCase().includes("poll"));
});

// ── safety guarantees ─────────────────────────────────────────────────────────

test("do_not_use_exit_code_alone is always present for every known action", () => {
  for (const action of ["merge", "escalate", "self_heal", "collecting", "recover_certification", "revoked"]) {
    const out = formatGateForAgent({ action, gate: { exit_code: action === "merge" ? 0 : 1 } });
    assert.ok(typeof out.agent_guidance.do_not_use_exit_code_alone === "string");
  }
});

test("revoked action tells the agent not to merge", () => {
  const out = formatGateForAgent({ action: "revoked", gate: { exit_code: 1 } });
  assert.match(out.agent_guidance.next_step_legacy, /revoked/i);
  assert.match(out.agent_guidance.when_blocked, /release_brief|governance_brief/i);
});

test("server next_step takes precedence over built-in guidance", () => {
  const out = formatGateForAgent({
    action: "escalate",
    next_step: "Fix accuracy then re-post signals",
    gate: { exit_code: 1 }
  });
  assert.equal(out.agent_guidance.next_step, "Fix accuracy then re-post signals");
  assert.match(out.agent_guidance.next_step_legacy, /escalate/i);
});

test("hub_links fall back to governance_brief.hub_links", () => {
  const releaseUrl = "https://useverdikt.com/releases?release=rel_nested";
  const out = formatGateForAgent({
    action: "escalate",
    gate: { exit_code: 1 },
    governance_brief: { suggested_verb: "escalate", hub_links: { release: releaseUrl } }
  });
  assert.equal(out.hub_links.release, releaseUrl);
  assert.equal(out.agent_guidance.hub_links.release, releaseUrl);
});

test("unknown future action is treated as blocked", () => {
  const out = formatGateForAgent({ action: "unknown_future_action", gate: { exit_code: 1 } });
  assert.equal(out.agent_guidance.action, "unknown_future_action");
  assert.ok(typeof out.agent_guidance.next_step === "string");
  assert.ok(out.agent_guidance.when_blocked, "unknown actions must not fail open");
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

test("gate SHA assertion accepts exact and abbreviated matches", () => {
  const full = "abcdef1234567890abcdef1234567890abcdef12";
  assert.equal(assertGateCommitSha({ commit_sha: full }, full).commit_sha, full);
  assert.equal(assertGateCommitSha({ commit_sha: full }, full.slice(0, 12)).commit_sha, full);
});

test("gate SHA assertion rejects stale or missing response identity", () => {
  assert.throws(
    () =>
      assertGateCommitSha(
        { action: "merge", commit_sha: "1111111111111111111111111111111111111111" },
        "2222222222222222222222222222222222222222"
      ),
    /gate_commit_sha_mismatch/
  );
  assert.throws(
    () => assertGateCommitSha({ action: "merge" }, "2222222222222222222222222222222222222222"),
    /returned=missing/
  );
});

test("original fields from gate response are preserved", () => {
  const input = { action: "merge", release_id: "rel_abc", workspace_id: "ws_1", can_merge: true, gate: { exit_code: 0 } };
  const out = formatGateForAgent(input);
  assert.equal(out.release_id, "rel_abc");
  assert.equal(out.workspace_id, "ws_1");
  assert.equal(out.can_merge, true);
});

test("blocked gate passes through governance_brief and hub_links", () => {
  const brief = {
    suggested_verb: "escalate",
    top_blockers: [{ signal_id: "accuracy", message: "below min" }],
    hub_links: { release: "https://useverdikt.com/releases?release=rel_abc" }
  };
  const out = formatGateForAgent({
    action: "escalate",
    gate: { exit_code: 1 },
    governance_brief: brief,
    hub_links: brief.hub_links
  });
  assert.equal(out.governance_brief.suggested_verb, "escalate");
  assert.equal(out.agent_guidance.suggested_verb, "escalate");
  assert.match(out.agent_guidance.when_blocked, /governance_brief/);
  assert.equal(out.hub_links.release, brief.hub_links.release);
});

// ── release brief ─────────────────────────────────────────────────────────────

test("formatReleaseBriefForAgent adds agent_guidance for blocked release", () => {
  const brief = {
    gate_action: "escalate",
    suggested_verb: "escalate",
    suggested_next_tool: "escalate",
    top_blockers: [{ type: "threshold_failed", message: "accuracy failed" }],
    regression_story: { has_regression: true, summary: "accuracy regressed" },
    next_step: "Fix accuracy",
    agent_note: "Do not merge"
  };
  const out = formatReleaseBriefForAgent(brief);
  assert.equal(out.agent_guidance.gate_action, "escalate");
  assert.equal(out.agent_guidance.suggested_verb, "escalate");
  assert.ok(out.agent_guidance.when_to_use.includes("release_brief"));
  assert.deepEqual(out.top_blockers, brief.top_blockers);
});
