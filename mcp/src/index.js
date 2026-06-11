#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiRequest, jsonResult, WORKSPACE_ID } from "./client.js";
import { formatGateForAgent } from "./gateFormat.js";

const server = new McpServer(
  {
    name: "verdikt",
    version: "0.1.0"
  },
  {
    instructions:
      "Verdikt certifies AI releases before production. Production flow: label verdikt:rc OR create_release with commit_sha, pr_number, github_owner, github_repo → post_signals or integration pull → check_gate. Read action: merge | self_heal | escalate. Escalate when blocked and self-heal is not possible."
  }
);

server.registerTool(
  "create_release",
  {
    description: "Open a certification window for a release before merge/deploy.",
    inputSchema: {
      version: z.string().describe("Release version or identifier (e.g. model-v2.1)"),
      release_type: z
        .enum(["prompt_update", "model_patch", "safety_patch", "policy_change", "model_update"])
        .optional()
        .describe("Type of AI release"),
      commit_sha: z.string().optional().describe("Git commit SHA (full or 7+ chars) — required for production"),
      pr_number: z.number().int().optional().describe("Pull request number"),
      github_owner: z.string().optional().describe("GitHub org or user (production anchor)"),
      github_repo: z.string().optional().describe("GitHub repository name (production anchor)"),
      github_branch: z.string().optional().describe("PR head branch"),
      callback_url: z.string().url().optional().describe("HTTPS URL to POST verdict when ready"),
      ai_context: z.record(z.unknown()).optional()
    }
  },
  async ({ version, release_type, commit_sha, pr_number, github_owner, github_repo, github_branch, callback_url, ai_context }) => {
    const out = await apiRequest("POST", `/api/workspaces/${WORKSPACE_ID}/releases`, {
      version,
      release_type: release_type || "model_update",
      commit_sha: commit_sha || null,
      pr_number: pr_number ?? null,
      github_owner: github_owner || null,
      github_repo: github_repo || null,
      github_branch: github_branch || null,
      callback_url: callback_url || null,
      ai_context: ai_context || {}
    });
    return jsonResult(out);
  }
);

server.registerTool(
  "post_signals",
  {
    description: "Post evaluation/QA signals for a collecting release.",
    inputSchema: {
      release_id: z.string(),
      signals: z.record(z.number()).describe("Map of signal_id → numeric value"),
      source: z.string().optional().describe("Signal source label, default agent")
    }
  },
  async ({ release_id, signals, source }) => {
    const out = await apiRequest("POST", `/api/releases/${release_id}/signals`, {
      source: source || "agent",
      signals
    });
    return jsonResult(out);
  }
);

server.registerTool(
  "get_verdict",
  {
    description: "Fetch release status, signals, intelligence, and blocking context.",
    inputSchema: {
      release_id: z.string()
    }
  },
  async ({ release_id }) => {
    const out = await apiRequest("GET", `/api/releases/${release_id}`);
    const verdict = out.intelligence?.verdict;
    return jsonResult({
      release_id,
      status: out.release?.status,
      certified: ["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"].includes(out.release?.status),
      blocking_signals: (verdict?.failed_signals || []).map((f) => f.signal_id).filter(Boolean),
      failed_signals: verdict?.failed_signals || [],
      signals: out.signals,
      intelligence: out.intelligence
    });
  }
);

server.registerTool(
  "check_gate",
  {
    description:
      "CI gate decision. IMPORTANT: read top-level action (merge | self_heal | escalate), not gate.exit_code alone.",
    inputSchema: {
      release_id: z.string(),
      mode: z.enum(["default", "strict"]).optional().describe("strict requires CERTIFIED without override")
    }
  },
  async ({ release_id, mode }) => {
    const qs = mode === "strict" ? "?mode=strict" : "";
    const out = await apiRequest("GET", `/api/releases/${release_id}/gate${qs}`);
    return jsonResult(formatGateForAgent(out));
  }
);

server.registerTool(
  "check_gate_by_sha",
  {
    description:
      "Gate by PR commit SHA (same as GitHub Actions). Read action, not exit_code alone.",
    inputSchema: {
      commit_sha: z.string().describe("PR head commit SHA"),
      pr_number: z.number().int().optional(),
      github_owner: z.string().optional(),
      github_repo: z.string().optional(),
      mode: z.enum(["default", "strict"]).optional()
    }
  },
  async ({ commit_sha, pr_number, github_owner, github_repo, mode }) => {
    const params = new URLSearchParams({ commit_sha });
    if (pr_number != null) params.set("pr_number", String(pr_number));
    if (github_owner) params.set("github_owner", github_owner);
    if (github_repo) params.set("github_repo", github_repo);
    if (mode === "strict") params.set("mode", "strict");
    const out = await apiRequest("GET", `/api/workspaces/${WORKSPACE_ID}/gate?${params.toString()}`);
    return jsonResult(formatGateForAgent(out));
  }
);

server.registerTool(
  "escalate",
  {
    description: "Request human review when the agent cannot self-heal blocking signals.",
    inputSchema: {
      release_id: z.string(),
      reason: z.string(),
      blocking_signals: z.array(z.string()).optional(),
      attempted_fixes: z.array(z.string()).optional()
    }
  },
  async ({ release_id, reason, blocking_signals, attempted_fixes }) => {
    const out = await apiRequest("POST", `/api/releases/${release_id}/escalate`, {
      reason,
      blocking_signals: blocking_signals || [],
      attempted_fixes: attempted_fixes || []
    });
    return jsonResult(out);
  }
);

server.registerTool(
  "record_outcome",
  {
    description: "Record post-production outcome for calibration (incident, clean, follow-up).",
    inputSchema: {
      release_id: z.string(),
      label: z.enum(["incident", "no_incident", "followup_met"]),
      notes: z.string().optional()
    }
  },
  async ({ release_id, label, notes }) => {
    const out = await apiRequest("POST", `/api/releases/${release_id}/intelligence/outcome`, {
      label,
      notes: notes || ""
    });
    return jsonResult(out);
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
