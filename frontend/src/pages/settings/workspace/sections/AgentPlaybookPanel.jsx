import React, { useMemo } from "react";

const DOCS_CURSOR_RULE_URL = "https://docs.useverdikt.com/agent/cursor-rule";
const NPM_MCP_REFERENCE_URL = "https://www.npmjs.com/package/@useverdikt/mcp";

const STEPS = [
  {
    title: "Open cert window",
    body: "Apply verdikt:rc on the PR (Settings → Release Trigger) or create_release with commit_sha, pr_number, github_owner, github_repo."
  },
  {
    title: "Collect signals",
    body: "On verdikt:rc, Verdikt auto-pulls connected integrations by commit SHA. Agent can also post_signals for CI-only metrics. Never invent values."
  },
  {
    title: "Check gate",
    body: "check_gate(release_id) — read action: merge | self_heal | escalate, plus missing_required_signals and blocking_signals."
  },
  {
    title: "Act or escalate",
    body: "merge → allowed to ship. self_heal → fix and re-run. escalate → human inbox + email (Settings → Governance)."
  }
];

export function buildAgentPromptTemplate({ prNumber = "N", prTitle = "PR title", commitSha = "abc123…", owner = "org", repo = "repo" }) {
  return `You are certifying a GitHub PR through Verdikt before merge.

PR: #${prNumber} — ${prTitle}
Commit: ${commitSha}
Repo: ${owner}/${repo}

Steps:
1. Ensure cert window exists (verdikt:rc label OR create_release with GitHub identity above).
2. Wait for integration auto-pull on label, or post_signals for CI-only metrics.
3. get_verdict — report status and blocking_signals.
4. check_gate — report action, can_merge, gate.exit_code, trajectory.
5. action merge → merge allowed. self_heal → fix and re-run. escalate → call escalate tool; do not merge.

Do not invent signal values.`;
}

export default function AgentPlaybookPanel({ wsId, toast }) {
  const promptTemplate = useMemo(
    () =>
      buildAgentPromptTemplate({
        prNumber: "34",
        prTitle: "Your PR title",
        commitSha: "<head-sha>",
        owner: "your-org",
        repo: "your-repo"
      }),
    []
  );

  function copy(text) {
    void navigator.clipboard?.writeText(text);
    toast("Copied to clipboard");
  }

  return (
    <div className="sblock">
      <div className="sblock-head">
        <div>
          <div className="sblock-title">Production agent playbook</div>
          <div className="sblock-desc">
            Label-first cert loop for coding agents. GitHub is source of truth for what ships; Verdikt certifies metrics for that commit.
          </div>
        </div>
        <button type="button" className="btn-ghost accent" onClick={() => copy(promptTemplate)}>
          Copy agent prompt
        </button>
      </div>
      <div className="sblock-body">
        <ol style={{ margin: "0 0 16px", paddingLeft: 20, lineHeight: 1.55 }}>
          {STEPS.map((s) => (
            <li key={s.title} style={{ marginBottom: 10 }}>
              <strong>{s.title}</strong> — {s.body}
            </li>
          ))}
        </ol>
        <pre className="code-block" style={{ overflow: "auto", fontSize: 11, maxHeight: 220 }}>
          {promptTemplate}
        </pre>
        <p className="muted" style={{ marginTop: 12 }}>
          <a href={DOCS_CURSOR_RULE_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accentL)" }}>
            Cursor rule (copy into your project) →
          </a>
          {" · "}
          <a href={NPM_MCP_REFERENCE_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accentL)" }}>
            MCP reference (@useverdikt/mcp) →
          </a>
          {wsId ? (
            <>
              {" "}
              · Workspace <code>{wsId}</code>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
