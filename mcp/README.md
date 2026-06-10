# Verdikt MCP Server

Model Context Protocol (MCP) tools so AI coding agents can certify releases through Verdikt before shipping to production.

**Verdikt certifies signal metrics against thresholds for a specific commit/PR — it does not diff source code.** Code lives in GitHub; CI produces signals for that code; Verdikt decides if those signals pass your governance bar.

---

## Setup

1. Create an API key in **Settings → Agent access** (human session only).
2. Configure MCP in `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "verdikt": {
      "command": "node",
      "args": ["/absolute/path/to/Verdikt MVP v1/mcp/src/index.js"],
      "env": {
        "VERDIKT_API_URL": "https://api.useverdikt.com",
        "VERDIKT_API_KEY": "vdk_live_…",
        "VERDIKT_WORKSPACE_ID": "ws_…"
      }
    }
  }
}
```

3. Install deps once: `cd mcp && npm install`
4. Restart Cursor after saving the config.

Local API: use `http://127.0.0.1:8787` for `VERDIKT_API_URL`.

---

## Tools

| Tool | Purpose |
|------|---------|
| `create_release` | Open certification window (anchor with `commit_sha`, `pr_number`, `github_owner`, `github_repo`) |
| `post_signals` | Submit eval/QA/perf metrics (usually from CI output) |
| `get_verdict` | Read status, blocking signals, intelligence |
| `check_gate` | Merge/deploy decision — read `action` and `gate.exit_code` |
| `escalate` | Hand off to human when blocked and self-heal failed |
| `record_outcome` | Post-prod calibration (`incident` / `no_incident`) |

---

## Production agent playbook (GitHub-anchored)

Use this flow when an agent ships code. **Do not** use bare version strings without a PR/commit except for smoke tests.

### Architecture

```
GitHub PR + commit          CI / integrations              Verdikt
─────────────────          ─────────────────              ───────
Agent opens/updates PR  →  Tests & evals run on SHA   →  Signals ingested
                           (Braintrust, BS, GHA)          Thresholds checked
                                                          Regression vs baseline
Agent labels PR or     →  Release tied to PR# + SHA  →  check_gate → merge/escalate
MCP create_release
```

Verdikt compares:

- **Thresholds** — did each signal pass its floor/ceiling?
- **Required signals** — did every required-for-cert metric arrive?
- **Regression** — did AI signals drop vs the last certified release?
- **Trajectory** — improving or degrading across recent releases?

It does **not** analyze git diffs or AST. Signals must represent what CI measured on **that commit**.

### Recommended flow (label trigger — preferred)

Best when GitHub App is connected in **Settings → Release Trigger**. GitHub is the source of truth for repo context.

1. Agent opens or updates a PR on a connected repo.
2. CI runs on the PR head commit and posts signals (CI webhook, integration pull, or agent `post_signals`).
3. Agent or human applies label **`verdikt:rc`** (or your configured label).
4. Verdikt auto-creates a release with `commit_sha`, `pr_number`, PR title, `trigger_source: github_label`.
5. Agent calls `check_gate(release_id, mode: "strict")`.
6. Read **`action`**: `merge` → merge PR; `self_heal` → fix and re-run CI; `escalate` → call `escalate` tool.

### Alternative flow (MCP create_release with GitHub metadata)

Use when the agent drives the session but still anchors to real code:

```
create_release(
  version: "Add agentic layer (#34)",
  release_type: "model_update",
  commit_sha: "<full SHA from PR head>",
  pr_number: 34,
  github_owner: "useverdikt",
  github_repo: "Verdikt",
  github_branch: "feat/my-branch"
)
→ post_signals(release_id, signals from CI)
→ check_gate(release_id, mode: "strict")
```

Always pass **`commit_sha`**, **`pr_number`**, and **`github_owner` / `github_repo`** so CI webhooks and integration pulls correlate to the same `release_id`. Repeat `create_release` with the same identity returns `reused: true`.

### Demo / smoke test only

```
create_release(version: "agent-demo-v1")  # no GitHub anchor — not for production
```

---

## Agent loop (`check_gate.action`)

After `check_gate`, use the top-level **`action`** field (not just `exit_code`):

| `action` | Agent behavior |
|----------|----------------|
| `merge` | `can_merge` is true — merge/deploy allowed |
| `self_heal` | Missing signals or still `COLLECTING` — fix code, re-run CI, post signals again |
| `escalate` | Threshold failures agent cannot fix — call `escalate`, wait for human override |

Example response:

```json
{
  "status": "UNCERTIFIED",
  "can_merge": false,
  "action": "escalate",
  "blocking_signals": ["accuracy"],
  "missing_required_signals": [],
  "gate": {
    "allowed": false,
    "exit_code": 1,
    "trajectory": "DEGRADING"
  }
}
```

- **`mode: strict`** — only pure `CERTIFIED` passes (not `CERTIFIED_WITH_OVERRIDE`).
- **`gate.exit_code: 0`** — pipeline may merge/deploy.

---

## CI webhook from GitHub Actions

Post signals from GHA after tests/evals. Copy `.github/workflows/verdikt-post-signals.example.yml` into your repo and set secrets:

- `VERDIKT_WEBHOOK_SECRET` — workspace inbound webhook secret (Settings → Integrations, or `WEBHOOK_SECRET` in dev)
- `VERDIKT_WORKSPACE_ID` — e.g. `ws_…`

The webhook matches releases by **`commit_sha`** (+ optional `pr_number`, `repo_owner`, `repo_name`). Same SHA as the `verdikt:rc` label or `create_release` call → same cert window.

See `backend/README.md` for the full CI webhook contract.

---

## Agent prompt template (Cursor / Claude Code)

```
You are certifying a GitHub PR through Verdikt before merge.

PR: #{PR_NUMBER} — {PR_TITLE}
Commit: {COMMIT_SHA}
Repo: {OWNER}/{REPO}

Steps:
1. If no release exists: apply label verdikt:rc OR create_release with version, commit_sha, pr_number, github_owner, github_repo.
2. Ensure CI signals are posted (GHA webhook or post_signals with CI output).
3. get_verdict — report status and blocking_signals.
4. check_gate mode strict — report action, exit_code, can_merge, trajectory.
5. action merge → merge allowed. self_heal → fix and re-run. escalate → call escalate tool, do not merge.

Do not invent signal values — use CI output or integration pull results.
```

---

## Required signals

Your workspace may require more than the five AI metrics. Check **Settings → Governance / Thresholds** for toggles marked required-for-certification.

Typical full set includes AI signals plus perf/mobile/QA, e.g.:

- AI: `accuracy`, `safety`, `tone`, `hallucination`, `relevance`
- QA: `smoke`, `e2e_regression`, `manual_qa_pct`
- Perf/mobile: `startup`, `screenload`, `fps`, `p95latency`, `crashrate`, `errorrate`

If any required signal is missing, status stays **`COLLECTING`** and `action` is **`self_heal`**.

---

## Escalation (human exception path)

```
escalate(
  release_id,
  reason: "accuracy below floor after 2 eval reruns",
  blocking_signals: ["accuracy"],
  attempted_fixes: ["Retuned prompt v2", "Re-ran eval suite"]
)
```

Humans review in the dashboard (Audit trail → `ESCALATION_REQUESTED`). Override requires VP/CTO session — not available via API key.

---

## curl reference (no MCP)

```bash
export VERDIKT_API_URL="https://api.useverdikt.com"
export VERDIKT_API_KEY="vdk_live_…"
export VERDIKT_WORKSPACE_ID="ws_…"
export PR_NUMBER=34
export COMMIT_SHA="025461fc2a331e0961553e6876e039b70842755f"

curl -sS -X POST "$VERDIKT_API_URL/api/workspaces/$VERDIKT_WORKSPACE_ID/releases" \
  -H "Authorization: Bearer $VERDIKT_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"version\":\"Add agentic layer (#$PR_NUMBER)\",\"release_type\":\"model_update\",\"commit_sha\":\"$COMMIT_SHA\",\"pr_number\":$PR_NUMBER,\"github_owner\":\"useverdikt\",\"github_repo\":\"Verdikt\"}"
```

---

## Security

- API keys are for **agent runtime only** — they cannot create other keys or change thresholds.
- Revoke compromised keys in **Settings → Agent access**.
- Never commit `mcp.json` with real keys to git; use `~/.cursor/mcp.json` or env vars.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Gate stuck `COLLECTING` | Post all required-for-cert signals |
| `action: self_heal` | Missing signals — check `missing_required_signals` |
| MCP silent in terminal | Normal — stdio server waits for Cursor |
| Release not tied to PR | Pass `commit_sha` + `pr_number` + repo, or use label trigger |
| Duplicate releases | Same SHA+PR should return `reused: true` on second `create_release` |
