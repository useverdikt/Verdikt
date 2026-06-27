#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiRequest, jsonResult, withAgentSession, WORKSPACE_ID } from "./client.js";
import { bindReleaseSession, ensureSessionId, resolveSessionId } from "./session.js";
import { formatGateForAgent, formatReleaseBriefForAgent } from "./gateFormat.js";

const SESSION_ID_FIELD = z
  .string()
  .optional()
  .describe(
    "Agent execution session for audit attribution. On create_release, omit to auto-generate; pass the returned agent_session_id on follow-up calls (or rely on release_id binding in this MCP process). Overrides VERDIKT_AGENT_SESSION_ID when set."
  );

function requestOpts({ session_id, release_id, createSessionIfMissing = false } = {}) {
  return {
    sessionId: session_id,
    releaseId: release_id,
    createSessionIfMissing
  };
}

function extractReleaseId(payload) {
  return payload?.id || payload?.release_id || payload?.release?.id || null;
}

const server = new McpServer(
  {
    name: "verdikt",
    version: "0.1.0"
  },
  {
    instructions:
      "Verdikt certifies AI releases before production. Production flow: label verdikt:rc OR create_release with commit_sha, pr_number, github_owner, github_repo → post_signals or integration pull → check_gate. Read action: merge | collecting | self_heal | recover_certification | escalate. When action is not merge, call release_brief for blockers, regression story, remediation debt, and suggested_verb — do not poll check_gate alone without that context. Poll check_gate only for CI grace/collecting windows. Pass session_id per agent execution for audit attribution; create_release returns agent_session_id when auto-generated."
  }
);

server.registerTool(
  "create_release",
  {
    description: "Open a certification window for a release before merge/deploy.",
    inputSchema: {
      session_id: SESSION_ID_FIELD,
      version: z.string().describe("Release version or identifier (e.g. model-v2.1)"),
      release_type: z
        .enum(["prompt_update", "model_patch", "safety_patch", "policy_change", "model_update", "incident_hotfix"])
        .optional()
        .describe("Type of AI release. incident_hotfix requires active incident context (remediation debt, VCS INVESTIGATING/INCIDENT, or confirmed prod INCIDENT) and is exempt from remediation debt gate blocks."),
      commit_sha: z.string().optional().describe("Git commit SHA (full or 7+ chars) — required for production"),
      pr_number: z.number().int().optional().describe("Pull request number"),
      github_owner: z.string().optional().describe("GitHub org or user (production anchor)"),
      github_repo: z.string().optional().describe("GitHub repository name (production anchor)"),
      github_branch: z.string().optional().describe("PR head branch"),
      callback_url: z.string().url().optional().describe("HTTPS URL to POST verdict when ready"),
      ai_context: z.record(z.unknown()).optional()
    }
  },
  async ({
    session_id,
    version,
    release_type,
    commit_sha,
    pr_number,
    github_owner,
    github_repo,
    github_branch,
    callback_url,
    ai_context
  }) => {
    const sessionId = ensureSessionId({ sessionId: session_id, createIfMissing: true });
    const out = await apiRequest(
      "POST",
      `/api/workspaces/${WORKSPACE_ID}/releases`,
      {
        version,
        release_type: release_type || "model_update",
        commit_sha: commit_sha || null,
        pr_number: pr_number ?? null,
        github_owner: github_owner || null,
        github_repo: github_repo || null,
        github_branch: github_branch || null,
        callback_url: callback_url || null,
        ai_context: ai_context || {}
      },
      requestOpts({ session_id: sessionId, createSessionIfMissing: false })
    );
    const releaseId = extractReleaseId(out);
    if (releaseId && sessionId) bindReleaseSession(releaseId, sessionId);
    return jsonResult(withAgentSession(out, sessionId));
  }
);

server.registerTool(
  "post_signals",
  {
    description: "Post evaluation/QA signals for a collecting release.",
    inputSchema: {
      session_id: SESSION_ID_FIELD,
      release_id: z.string(),
      signals: z.record(z.number()).describe("Map of signal_id → numeric value"),
      source: z.string().optional().describe("Signal source label, default agent")
    }
  },
  async ({ session_id, release_id, signals, source }) => {
    const out = await apiRequest(
      "POST",
      `/api/releases/${release_id}/signals`,
      {
        source: source || "agent",
        signals
      },
      requestOpts({ session_id, release_id })
    );
    return jsonResult(withAgentSession(out, resolveSessionId({ sessionId: session_id, releaseId: release_id })));
  }
);

server.registerTool(
  "get_verdict",
  {
    description: "Fetch release status, signals, intelligence, and blocking context.",
    inputSchema: {
      session_id: SESSION_ID_FIELD,
      release_id: z.string()
    }
  },
  async ({ session_id, release_id }) => {
    const out = await apiRequest("GET", `/api/releases/${release_id}`, null, requestOpts({ session_id, release_id }));
    const verdict = out.intelligence?.verdict;
    return jsonResult(
      withAgentSession(
        {
          release_id,
          status: out.release?.status,
          certified: ["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"].includes(out.release?.status),
          blocking_signals: (verdict?.failed_signals || []).map((f) => f.signal_id).filter(Boolean),
          failed_signals: verdict?.failed_signals || [],
          signals: out.signals,
          intelligence: out.intelligence
        },
        resolveSessionId({ sessionId: session_id, releaseId: release_id })
      )
    );
  }
);

server.registerTool(
  "check_gate",
  {
    description:
      "CI gate decision. IMPORTANT: read top-level action (merge | collecting | self_heal | recover_certification | escalate). Poll on collecting/self_heal; recover_certification when remediation debt blocks; do not fail on the first check while signals are in flight.",
    inputSchema: {
      session_id: SESSION_ID_FIELD,
      release_id: z.string(),
      mode: z.enum(["default", "strict"]).optional().describe("strict requires CERTIFIED without override")
    }
  },
  async ({ session_id, release_id, mode }) => {
    const qs = mode === "strict" ? "?mode=strict" : "";
    const out = await apiRequest(
      "GET",
      `/api/releases/${release_id}/gate${qs}`,
      null,
      requestOpts({ session_id, release_id })
    );
    return jsonResult(
      withAgentSession(formatGateForAgent(out), resolveSessionId({ sessionId: session_id, releaseId: release_id }))
    );
  }
);

server.registerTool(
  "release_brief",
  {
    description:
      "Deterministic release governance brief — verdict, top blockers, regression story, remediation debt, suggested_verb (merge | poll | escalate), and Intelligence Hub links. Prefer this over polling check_gate alone when the gate is blocked or uncertified.",
    inputSchema: {
      session_id: SESSION_ID_FIELD,
      release_id: z.string(),
      mode: z.enum(["default", "strict"]).optional().describe("strict requires CERTIFIED without override")
    }
  },
  async ({ session_id, release_id, mode }) => {
    const qs = mode === "strict" ? "?mode=strict" : "";
    const out = await apiRequest(
      "GET",
      `/api/releases/${release_id}/release-brief${qs}`,
      null,
      requestOpts({ session_id, release_id })
    );
    return jsonResult(
      withAgentSession(
        formatReleaseBriefForAgent(out),
        resolveSessionId({ sessionId: session_id, releaseId: release_id })
      )
    );
  }
);

server.registerTool(
  "check_gate_by_sha",
  {
    description:
      "Gate by PR commit SHA (same as GitHub Actions). Read action, not exit_code alone.",
    inputSchema: {
      session_id: SESSION_ID_FIELD,
      commit_sha: z.string().describe("PR head commit SHA"),
      pr_number: z.number().int().optional(),
      github_owner: z.string().optional(),
      github_repo: z.string().optional(),
      mode: z.enum(["default", "strict"]).optional()
    }
  },
  async ({ session_id, commit_sha, pr_number, github_owner, github_repo, mode }) => {
    const params = new URLSearchParams({ commit_sha });
    if (pr_number != null) params.set("pr_number", String(pr_number));
    if (github_owner) params.set("github_owner", github_owner);
    if (github_repo) params.set("github_repo", github_repo);
    if (mode === "strict") params.set("mode", "strict");
    const out = await apiRequest(
      "GET",
      `/api/workspaces/${WORKSPACE_ID}/gate?${params.toString()}`,
      null,
      requestOpts({ session_id })
    );
    const releaseId = extractReleaseId(out);
    const sessionId = resolveSessionId({ sessionId: session_id });
    if (releaseId && sessionId) bindReleaseSession(releaseId, sessionId);
    return jsonResult(withAgentSession(formatGateForAgent(out), sessionId));
  }
);

server.registerTool(
  "escalate",
  {
    description: "Request human review when the agent cannot self-heal blocking signals.",
    inputSchema: {
      session_id: SESSION_ID_FIELD,
      release_id: z.string(),
      reason: z.string(),
      blocking_signals: z.array(z.string()).optional(),
      attempted_fixes: z.array(z.string()).optional()
    }
  },
  async ({ session_id, release_id, reason, blocking_signals, attempted_fixes }) => {
    const out = await apiRequest(
      "POST",
      `/api/releases/${release_id}/escalate`,
      {
        reason,
        blocking_signals: blocking_signals || [],
        attempted_fixes: attempted_fixes || []
      },
      requestOpts({ session_id, release_id })
    );
    return jsonResult(withAgentSession(out, resolveSessionId({ sessionId: session_id, releaseId: release_id })));
  }
);

server.registerTool(
  "get_calibration_suggestions",
  {
    description:
      "List pending prod calibration threshold suggestions (MISS tighten / CAUTIOUS loosen). Suggest-only — thresholds change only after a human applies on Thresholds. Use with check_gate calibration context before certifying borderline releases.",
    inputSchema: {
      session_id: SESSION_ID_FIELD
    }
  },
  async ({ session_id }) => {
    const out = await apiRequest(
      "GET",
      `/api/workspaces/${WORKSPACE_ID}/calibration-suggestions`,
      null,
      requestOpts({ session_id })
    );
    const suggestions = out.suggestions || [];
    return jsonResult(
      withAgentSession(
        {
          workspace_id: WORKSPACE_ID,
          mode: out.mode || "suggest_only",
          apply_on: out.apply_on || "/thresholds",
          pending_count: suggestions.length,
          suggestions: suggestions.map((s) => ({
            id: s.id,
            signal_id: s.signal_id,
            direction: s.direction,
            current: s.current,
            suggested: s.suggested,
            alignment: s.alignment,
            release_version: s.release_version,
            reason: s.reason,
            apply_note: "Humans apply via Thresholds UI or threshold-suggestions apply API (human session)."
          })),
          context: out.context || null,
          agent_note:
            suggestions.length > 0
              ? `${suggestions.length} prod-derived suggestion(s) pending. Review before shipping similar releases.`
              : "No pending prod calibration suggestions."
        },
        resolveSessionId({ sessionId: session_id })
      )
    );
  }
);

server.registerTool(
  "get_regression_history",
  {
    description:
      "Agent playbook v2. Returns the regression history for a release — consecutive regression streak, prior-window failure count, and per-signal trend for each failing signal. Use this before deciding to escalate or self-heal: a 3+ streak signals a systemic issue that warrants escalation rather than a quick fix.",
    inputSchema: {
      session_id: SESSION_ID_FIELD,
      release_id: z.string().describe("Release ID to inspect for regression patterns")
    }
  },
  async ({ session_id, release_id }) => {
    const out = await apiRequest(
      "GET",
      `/api/releases/${release_id}/regression-history`,
      null,
      requestOpts({ session_id, release_id })
    );
    const history = out.regression_history;

    if (!history || !history.signals?.length) {
      return jsonResult(
        withAgentSession(
          {
            release_id,
            status: out.status,
            has_regression: false,
            message:
              "No regression history found. Either no prior certified baseline exists, or no regression-type failures were detected.",
            regression_history: null
          },
          resolveSessionId({ sessionId: session_id, releaseId: release_id })
        )
      );
    }

    const signals = history.signals.map((s) => ({
      signal_id: s.signal_id,
      consecutive_regression_releases: s.consecutive_regression_releases,
      prior_window_failures: `${s.prior_regression_failures_in_window} / ${s.prior_releases_in_window} prior releases`,
      streak_severity:
        s.consecutive_regression_releases >= 3
          ? "HIGH — escalate"
          : s.consecutive_regression_releases >= 2
            ? "MEDIUM — investigate"
            : "LOW — monitor"
    }));

    const maxStreak = Math.max(...signals.map((s) => s.consecutive_regression_releases));
    const recommendation =
      maxStreak >= 3
        ? "ESCALATE — 3+ consecutive regression releases indicate a systemic issue."
        : maxStreak >= 2
          ? "INVESTIGATE — consecutive regressions detected; review model/prompt changes between releases."
          : "MONITOR — single regression; self-heal attempt is reasonable.";

    return jsonResult(
      withAgentSession(
        {
          release_id,
          status: out.status,
          has_regression: true,
          recommendation,
          signals,
          prior_window_size: history.prior_window_size
        },
        resolveSessionId({ sessionId: session_id, releaseId: release_id })
      )
    );
  }
);

server.registerTool(
  "record_outcome",
  {
    description: "Record post-production outcome for calibration (incident, clean, follow-up).",
    inputSchema: {
      session_id: SESSION_ID_FIELD,
      release_id: z.string(),
      label: z.enum(["incident", "no_incident", "followup_met"]),
      notes: z.string().optional()
    }
  },
  async ({ session_id, release_id, label, notes }) => {
    const out = await apiRequest(
      "POST",
      `/api/releases/${release_id}/intelligence/outcome`,
      {
        label,
        notes: notes || ""
      },
      requestOpts({ session_id, release_id })
    );
    return jsonResult(withAgentSession(out, resolveSessionId({ sessionId: session_id, releaseId: release_id })));
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[verdikt-mcp] fatal:", err);
  process.exit(1);
});
