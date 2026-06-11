/** Normalize gate API response with agent-facing guidance (read action, not exit_code alone). */
export function formatGateForAgent(out) {
  const action = out?.action || "unknown";
  const exitCode = out?.gate?.exit_code ?? 1;
  const guidance = {
    merge: "Merge/deploy allowed. GHA exit_code 0 is sufficient for branch protection.",
    self_heal: "Do not merge. Fix code, re-run evals, post missing signals, then check_gate again.",
    escalate: "Do not merge. Call escalate tool; wait for human override in Escalations inbox."
  };
  return {
    ...out,
    agent_guidance: {
      read_field: "action",
      action,
      do_not_use_exit_code_alone:
        "exit_code can be 0 while action is self_heal or escalate (e.g. CERTIFIED_WITH_OVERRIDE in strict mode).",
      next_step: guidance[action] || "Call check_gate again after signals update.",
      gha_note: "GitHub Actions should use gate.exit_code only; agents must use action."
    },
    recommended_next: guidance[action] || null
  };
}
