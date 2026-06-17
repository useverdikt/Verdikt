# Dogfood runbook — Verdikt on useverdikt/Verdikt

Prove the full loop on your own repo: **label → cert → GHA gate → commit status → merge**.

Prod API check (2026-06): `GET https://api.useverdikt.com/health/ready` → `{"ok":true,"checks":{"database":true}}`

**App URL:** [https://useverdikt.com](https://useverdikt.com) (log in → `/releases`, `/thresholds`, `/settings`). Legacy **`app.useverdikt.com`** redirects to the same host (`vercel.json` + add **`app.useverdikt.com`** as a domain on the Vercel project if it still 404s). Do not share the old subdomain with partners.

### Pre-call prod verify (Signal Sources panel)

Confirm migrations **019–020** are live before a partner demo (panel API returns structured data, not 500):

```bash
curl -sS -o /tmp/si.json -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $VERDIKT_API_KEY" \
  "https://api.useverdikt.com/api/workspaces/$VERDIKT_WORKSPACE_ID/signal-integrations"
jq '.pull_connectors | length, .push_sources | length' /tmp/si.json
```

Expect **HTTP 200** and JSON with `pull_connectors`, `push_sources`, `api_push`. A **500** usually means Railway needs the latest API deploy + migrations applied.

---

## One-time setup (~30 min)

### 1. Verdikt workspace ([useverdikt.com](https://useverdikt.com))

| Step | Where | Action |
|------|--------|--------|
| GitHub App | Settings → Release Trigger | Connect app, select **useverdikt/Verdikt**, save label **`verdikt:rc`** |
| VCS writeback | Settings → Release Trigger → VCS write-back | GitHub PAT (`repo` scope), owner **`useverdikt`**, repo **`Verdikt`** |
| API key | Settings → Agent access | Generate key → use in GitHub secrets |
| Thresholds | App → **Thresholds** (`/thresholds`) | Adopt signals from the library or add custom; set floors and required toggles |
| Integrations | Settings → Signal sources | Optional for v1 dogfood — use **Signal Simulator** if none connected |
| Signal sim workspaces | API env `INTERNAL_WORKSPACE_VIEWER_EMAILS` | Comma-separated operator emails (e.g. `joseph@useverdikt.com,founder@zizka.ai`) so `/signal-sim` lists all active workspaces for internal testing |

### 2. GitHub repo secrets (useverdikt/Verdikt)

Settings → Secrets and variables → Actions:

| Secret | Value |
|--------|--------|
| `VERDIKT_API_URL` | `https://api.useverdikt.com` |
| `VERDIKT_API_KEY` | `vdk_live_…` from Agent access |
| `VERDIKT_WORKSPACE_ID` | your `ws_…` id |

Optional (prod smoke workflow): `PROD_SMOKE_API_KEY`, `PROD_SMOKE_WORKSPACE_ID` — same values.

### 3. Repository ruleset (main) — **enabled**

Merge enforcement on **useverdikt/Verdikt** uses a GitHub **repository ruleset** (Settings → Rules → Rulesets), not legacy branch protection.

| Setting | Value |
|---------|--------|
| Ruleset name | `main` |
| Enforcement status | **Active** |
| Target branches | Include by pattern → `main` |
| Require a pull request before merging | On |
| Require status checks to pass | On — add **`verdikt-gate`** (shows as **Verdikt gate / verdikt-gate** on PRs) |

Workflow file: `.github/workflows/verdikt-gate.yml` (runs only when PR has label `verdikt:rc`).

**Behavior:**

| PR state | `verdikt-gate` check | Merge button |
|----------|----------------------|--------------|
| No `verdikt:rc` label | Skipped | Enabled (gate not in play) |
| `verdikt:rc` + certified | Green | Enabled |
| `verdikt:rc` + failed / timeout | Red (Required) | **Disabled** |

**Re-run after fixing signals:** The gate workflow only triggers on PR `opened`, `synchronize`, `reopened`, or `labeled`. Ingesting signals or moving from `self_heal` → certified in Verdikt does **not** re-trigger GitHub Actions. If the gate already failed red, merge stays blocked until you **manually re-run** the check:

1. PR → **Checks** → **Verdikt gate / verdikt-gate** → **Re-run failed jobs**, or  
2. **Actions** → **Verdikt gate** → select the run → **Re-run all jobs**

Alternatives: push a new commit to the PR (`synchronize`), or remove and re-add **`verdikt:rc`**. Probe the API without waiting on GHA: `./scripts/dogfood-gate-probe.sh "$SHA" "$PR" useverdikt Verdikt`.

```bash
gh api repos/useverdikt/Verdikt/rulesets --jq '.[] | {name, enforcement, targets: .conditions.ref_name.include}'
```

Expect ruleset `main`, enforcement `active`, target pattern `main`. Legacy `gh api …/branches/main/protection` returns 404 when only a ruleset is configured.

The gate job **polls** the API (12 × 10s) — it does not fail on the first check while signals are still arriving. Expect **30–60 seconds** after labeling for integration auto-pull to populate the cert window.

**Before relying on the ruleset (partners too):**

1. Confirm SHA tagging on at least one signal integration (Settings → Signal sources → Probe SHA match).
2. Use the polling workflow from `docs/examples/verdikt-gate-gha.yml` — not a single-check curl.
3. Set expectation: first `verdikt:rc` on a PR opens COLLECTING; gate returns `action: collecting` for ~60s, then `self_heal` if evidence never lands.
4. If merge stays enabled after a red gate: ruleset is **Disabled**, has no **target branch**, or `verdikt-gate` is not listed under required status checks.

---

## Smoke PR (~20 mins)

### 1. Open a test PR

```bash
git checkout -b dogfood/gate-smoke
# trivial change, e.g. docs/DOGFOOD_RUNBOOK.md checkbox
git push -u origin dogfood/gate-smoke
# open PR to main on GitHub
```

### 2. Start certification

On the PR: add label **`verdikt:rc`**.

Verdikt should open a **COLLECTING** release for the PR head SHA (Releases tab in app).

### 3. Supply signals (pick one)

**A. Signal Simulator (fastest, no integrations)**

1. App → Signal Simulator
2. Select the release for this PR / SHA
3. Post passing values for required signals (accuracy, safety, tone, hallucination, relevance, etc.)

**B. Integration auto-pull**

Connect Braintrust/BrowserStack with SHA-tagged runs matching the PR head commit.

### 4. Wait for verdict

Release status → **CERTIFIED** (or override path for negative test).

If the gate job already finished **red** before signals landed, re-run **Verdikt gate** on the PR (see §3 above) — the check does not auto-retry when evidence arrives later.

### 5. Verify enforcement

| Check | Expected |
|-------|----------|
| **Verdikt gate** / `verdikt-gate` | Green (`gate.exit_code === 0`) |
| GitHub commit status | **verdikt/certification** success on head SHA (VCS writeback) |
| PR comment | Verdikt certification comment on PR (if writeback configured) |
| Merge button | Enabled only when ruleset is active and gate is green (or gate skipped — no label) |

Re-run gate manually (API probe — does not update the PR check):

```bash
./scripts/dogfood-gate-probe.sh "$SHA" "$PR" useverdikt Verdikt
```

To clear a red **Required** check after certifying, use **Re-run failed jobs** on the **Verdikt gate** workflow run (see §3).

### 6. Merge

Merge the PR when gate is green.

### 7. Optional: alignment row

After deploy/monitor window: Intelligence → check outcome alignment for that release (proves learning loop).

---

## Negative test (recommended once)

1. Open PR, label `verdikt:rc`
2. Post **failing** signals (below threshold) or leave required signals missing
3. Confirm: gate **red**, merge **blocked**, status **failure** or still **pending**

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Gate 404 | Apply `verdikt:rc` first; confirm SHA matches PR head |
| Gate red, COLLECTING | Post signals or fix integration SHA tags (Settings → probe SHA) |
| No commit status on GitHub | Configure VCS write-back PAT (separate from GitHub App) |
| Label does nothing | GitHub App not installed on repo or label name mismatch |
| Secrets error in GHA | Add `VERDIKT_API_KEY` + `VERDIKT_WORKSPACE_ID` |
| Gate red but release is CERTIFIED in app | Re-run **Verdikt gate** on the PR — signal ingest does not re-trigger the workflow |
| Gate red but merge still enabled | Ruleset **Disabled**, no target on `main`, or `verdikt-gate` not in required checks |

---

## Done criteria (demo-ready)

- [x] Repository ruleset on `main` requires `verdikt-gate` (enforcement active)
- [ ] One PR certified via `verdikt:rc` + Signal Simulator
- [ ] GHA **Verdikt gate** blocked then passed
- [ ] GitHub commit status visible on PR
- [ ] Screenshot of audit trail + cert record for sales deck
- [ ] (Stretch) One alignment row after deploy

---

## Agent autonomy run

Agent-owned: branch → PR → `verdikt:rc` → poll `check_gate_by_sha` → report `missing_required_signals`.  
Human-owned: Signal Simulator ingest only when agent requests it.

---

## Continuous dogfood enforcement

Treat Verdikt-on-Verdikt as **always on**, not a one-off demo:

| Rule | Why |
|------|-----|
| Every merge-bound PR gets **`verdikt:rc`** before review | Opens the cert window for the PR head SHA |
| **Ruleset on `main`** requires `verdikt-gate` | Merge blocked when labeled PR fails gate — **live on useverdikt/Verdikt** |
| Gate failure → read **`blockers`** + **`next_step`** in GHA logs | Structured reason instead of guessing why COLLECTING |
| Gate job **polls** (12 × 10s) — waits on `action: collecting` | Avoids racing integration auto-pull on label; if it times out red, **re-run the job** after signals land |
| Keep repo secrets current (`VERDIKT_API_KEY`, `VERDIKT_WORKSPACE_ID`) | Gate job must resolve the same workspace as the app |
| Screenshot audit trail + cert record after each dogfood PR | Sales/demo proof that we eat our own cooking |

PR template (`.github/pull_request_template.md`) reminds contributors to label PRs for certification.

When demoing to partners, say: **“Our own repo runs through Verdikt before merge.”**
