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

In-app copy: **Settings → Agent access** (playbook + MCP snippet). Cursor rule: `.cursor/rules/verdikt.mdc`.

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
GitHub PR + commit          Verdikt (cert window)           Integrations / agent
─────────────────          ─────────────────────           ────────────────────
Agent opens/updates PR  →  Label verdikt:rc (or MCP      →  Auto-pull Braintrust, BrowserStack,
                           create_release with SHA)            Sentry, Datadog by commit_sha
                                                          →  Or agent post_signals for CI-only metrics
Agent calls check_gate  →  Thresholds + regression +     →  merge | self_heal | escalate
                           trajectory
```

Verdikt collects signals — **GHA does not need to POST them** unless you have custom metrics only available in your pipeline (see `docs/examples/verdikt-ci-webhook.optional.md`).

Verdikt compares:

- **Thresholds** — did each signal pass its floor/ceiling?
- **Required signals** — did every required-for-cert metric arrive?
- **Regression** — did AI signals drop vs the last certified release?
- **Trajectory** — improving or degrading across recent releases?

It does **not** analyze git diffs or AST. Signals must represent what CI measured on **that commit**.

### Recommended flow (label trigger — preferred)

Best when GitHub App is connected in **Settings → Release Trigger**. GitHub is the source of truth for repo context.

1. Agent opens or updates a PR on a connected repo.
2. Apply label **`verdikt:rc`** (or agent `create_release` with `commit_sha`, `pr_number`, `github_owner`, `github_repo`).
3. Verdikt opens a cert window tied to PR# + SHA and **auto-pulls connected integrations**. Agent **`post_signals`** only for CI-only metrics — not from GHA by default.
4. Agent calls `check_gate(release_id, mode: "strict")`.
5. Read **`action`**: `merge` → merge PR; `self_heal` → fix and re-pull/post signals; `escalate` → call `escalate` (human inbox at **Escalations**).

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

Always pass **`commit_sha`**, **`pr_number`**, and **`github_owner` / `github_repo`** so integration pulls correlate to the same `release_id`. Repeat `create_release` with the same identity returns `reused: true`.

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

## Optional: CI webhook (advanced)

Only if GHA computes metrics that Verdikt integrations cannot pull. **Not required** for the label-trigger + integration-pull model.

Reference: `docs/examples/verdikt-ci-webhook.optional.md` (curl only — do not add to `.github/workflows/` unless you intend to run it).

---

## Agent prompt template (Cursor / Claude Code)

```
You are certifying a GitHub PR through Verdikt before merge.

PR: #{PR_NUMBER} — {PR_TITLE}
Commit: {COMMIT_SHA}
Repo: {OWNER}/{REPO}

Steps:
1. If no release exists: apply label verdikt:rc OR create_release with version, commit_sha, pr_number, github_owner, github_repo.
2. After label: wait for auto-pull, or post_signals for CI-only metrics (do not invent values).
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

### SHA tagging (partner requirement)

Integration auto-pull matches eval/build/release data to the **PR head commit SHA**. If Braintrust, BrowserStack, Sentry, or Datadog do not tag runs with `git_sha` / `commit_sha` metadata, the cert window stays `COLLECTING` and the UI shows an **Integration pull · action needed** banner naming the source and fix.

**Partner checklist:**
1. Apply `verdikt:rc` on a PR with a known head SHA.
2. Confirm Settings → Signal sources shows each integration **Connected**.
3. Tag eval runs in Braintrust (and other tools) with the same git SHA.
4. If pull fails, use Signal Simulator or `post_signals` — do not assume silent success.
5. Re-pull from the release row or wait for label auto-pull after fixing tags.

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

Humans resolve in **Escalations** inbox via **Acknowledge & Override** (one step); SLA reminders use **Settings → Governance** escalation email.
