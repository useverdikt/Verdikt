/** Normalize gate API response with agent-facing guidance (read action, not exit_code alone). */
export function formatGateForAgent(out) {
  const action = out?.action || "unknown";
  const exitCode = out?.gate?.exit_code ?? 1;
  const guidance = {
    merge: "Merge/deploy allowed. GHA exit_code 0 is sufficient for branch protection.",
    collecting:
      "Signals still arriving. Poll check_gate again — do not treat as failure during the collection grace window.",
    self_heal:
      "Do not merge. Read remediation (summary, failures, suggested_actions) for workspace-specific context, fix root cause, re-post signals if needed, then check_gate again.",
    escalate: "Do not merge. Call escalate tool; wait for human override in Escalations inbox."
  };
  return {
    ...out,
    remediation: out?.remediation || null,
    certification: out?.certification || null,
    calibration: out?.calibration || null,
    agent_guidance: {
      read_field: "action",
      action,
      remediation: out?.remediation || null,
      certification: out?.certification || null,
      calibration: out?.calibration || null,
      blockers: out?.blockers || [],
      next_step: out?.next_step || guidance[action] || "Call check_gate again after signals update.",
      do_not_use_exit_code_alone:
        "exit_code can be 0 while action is self_heal or escalate (e.g. CERTIFIED_WITH_OVERRIDE in strict mode).",
      next_step_legacy: guidance[action] || "Call check_gate again after signals update.",
      gha_note:
        "GitHub Actions should poll action: wait on collecting/self_heal, exit 0 on merge, exit 1 on escalate or timeout. gate.exit_code alone is not enough during COLLECTING."
    },
    recommended_next: out?.next_step || guidance[action] || null
  };
}
