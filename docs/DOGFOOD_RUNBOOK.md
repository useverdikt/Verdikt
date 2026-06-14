# Dogfood runbook — Verdikt on useverdikt/Verdikt

Prove the full loop on your own repo: **label → cert → GHA gate → commit status → merge**.

Prod API check (2026-06): `GET https://api.useverdikt.com/health/ready` → `{"ok":true,"checks":{"database":true}}`

---

## One-time setup (~30 min)

### 1. Verdikt workspace (app.useverdikt.com)

| Step | Where | Action |
|------|--------|--------|
| GitHub App | Settings → Release Trigger | Connect app, select **useverdikt/Verdikt**, save label **`verdikt:rc`** |
| VCS writeback | Settings → Release Trigger → VCS write-back | GitHub PAT (`repo` scope), owner **`useverdikt`**, repo **`Verdikt`** |
| API key | Settings → Agent access | Generate key → use in GitHub secrets |
| Thresholds | Settings → Thresholds | Ensure required AI signals have floors (defaults OK for smoke) |
| Integrations | Settings → Signal sources | Optional for v1 dogfood — use **Signal Simulator** if none connected |

### 2. GitHub repo secrets (useverdikt/Verdikt)

Settings → Secrets and variables → Actions:

| Secret | Value |
|--------|--------|
| `VERDIKT_API_URL` | `https://api.useverdikt.com` |
| `VERDIKT_API_KEY` | `vdk_live_…` from Agent access |
| `VERDIKT_WORKSPACE_ID` | your `ws_…` id |

Optional (prod smoke workflow): `PROD_SMOKE_API_KEY`, `PROD_SMOKE_WORKSPACE_ID` — same values.

### 3. Branch protection (main)

Settings → Branches → rule for `main`:

- Require status check **`Verdikt gate`** (job name `verdikt-gate`)
- Require PR before merging

Workflow file: `.github/workflows/verdikt-gate.yml` (runs only when PR has label `verdikt:rc`).

The gate job **polls** the API (12 × 10s) — it does not fail on the first check while signals are still arriving. Expect **30–60 seconds** after labeling for integration auto-pull to populate the cert window.

**Before enabling branch protection (partners too):**

1. Confirm SHA tagging on at least one signal integration (Settings → Signal sources → Probe SHA match).
2. Use the polling workflow from `docs/examples/verdikt-gate-gha.yml` — not a single-check curl.
3. Set expectation: first `verdikt:rc` on a PR opens COLLECTING; gate returns `action: collecting` for ~60s, then `self_heal` if evidence never lands.

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

### 5. Verify enforcement

| Check | Expected |
|-------|----------|
| GHA **Verdikt gate** | Green (`gate.exit_code === 0`) |
| GitHub commit status | **verdikt/certification** success on head SHA (VCS writeback) |
| PR comment | Verdikt certification comment on PR (if writeback configured) |
| Merge button | Enabled only if branch protection + gate green |

Re-run gate manually:

```bash
./scripts/dogfood-gate-probe.sh "$SHA" "$PR" useverdikt Verdikt
```

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

---

## Done criteria (demo-ready)

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
| **Branch protection** requires `Verdikt gate / verdikt-gate` | Merge blocked until evidence passes |
| Gate failure → read **`blockers`** + **`next_step`** in GHA logs | Structured reason instead of guessing why COLLECTING |
| Gate job **polls** (12 × 10s) — waits on `action: collecting` | Avoids racing integration auto-pull on label |
| Keep repo secrets current (`VERDIKT_API_KEY`, `VERDIKT_WORKSPACE_ID`) | Gate job must resolve the same workspace as the app |
| Screenshot audit trail + cert record after each dogfood PR | Sales/demo proof that we eat our own cooking |

PR template (`.github/pull_request_template.md`) reminds contributors to label PRs for certification.

When demoing to partners, say: **“Our own repo runs through Verdikt before merge.”**
