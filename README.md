<p align="center">
  <img src="frontend/public/favicon.svg" alt="Verdikt logo" width="72" />
</p>

<h1 align="center">Verdikt</h1>

<p align="center">
  <strong>The trust layer between AI agents and production.</strong>
</p>

<p align="center">
  <a href="https://useverdikt.com"><img alt="App" src="https://img.shields.io/badge/App-useverdikt.com-111827?style=flat&logo=vercel&logoColor=white"></a>
  <a href="https://docs.useverdikt.com"><img alt="Docs" src="https://img.shields.io/badge/Docs-docs.useverdikt.com-111827?style=flat"></a>
  <img alt="Frontend" src="https://img.shields.io/badge/React%20%2B%20Vite-2563eb?style=flat&logo=react&logoColor=white">
  <img alt="Backend" src="https://img.shields.io/badge/Express-111827?style=flat&logo=express&logoColor=white">
  <img alt="Database" src="https://img.shields.io/badge/Postgres-059669?style=flat&logo=supabase&logoColor=white">
</p>

---

Verdikt certifies AI releases before merge — signals in, merge / self_heal / escalate out, humans accountable on override, every decision on record.

It sits above your eval stack (Braintrust, LangSmith, Sentry, Datadog, BrowserStack) and below your CI gate. It does not review code diffs, run tests, or fix failing signals. It certifies whether the evidence says a release is safe to ship.

## How it works

```
PR labeled verdikt:rc
  → Cert window opens (anchored to commit SHA)
  → Signals arrive — integration pull or API push
  → Verdict engine evaluates thresholds + regression deltas
  → Gate: COLLECTING → CERTIFIED · UNCERTIFIED · CERTIFIED_WITH_OVERRIDE
  → action: collecting | merge | self_heal | escalate
  → Branch protection enforces the gate (when configured)
  → Post-deploy: outcome alignment (CORRECT · MISS · OVER_BLOCK)
  → Calibration: threshold suggestions from alignment (human review by default)
```

## Production truth

Verdikt records what actually reaches production — not just what cleared the gate.

- **Bypass tracking** — merges without certification freeze `shipped_without_certification` at merge time; live risk stays on the record even if certified later.
- **Calibration** — post-deploy CORRECT / MISS / OVER_BLOCK outcomes feed threshold suggestions; humans review by default (`auto_apply` is opt-in for design partners).
- **Override vs bypass** — override requires justification and a signed record; bypass is recorded without one.
- **Incident flow** — VCS Production Monitor watches for reverts, hotfixes, and incident-labelled PRs after deploy; link an `incident_ref` on the alignment row or call `record_outcome` for calibration.

Dogfood the full loop (gate + incident): [docs/DOGFOOD_RUNBOOK.md](docs/DOGFOOD_RUNBOOK.md).

## Signal sources

| Method | Best for | Auth |
| --- | --- | --- |
| Integration pull | Braintrust, LangSmith, BrowserStack, Sentry, Datadog | API credentials in Settings |
| API push | Custom eval pipelines, partner databases | Agent access key (`vdk_live_…`) |
| CSV upload | Manual QA, ad-hoc imports | Workspace session or Agent key |

Full setup: [docs.useverdikt.com/connecting-signals/overview](https://docs.useverdikt.com/connecting-signals/overview)

## Agent setup (MCP)

Verdikt exposes MCP tools for Cursor, Claude Code, and any MCP-compatible agent runtime. Install via `npx -y @useverdikt/mcp` — no local repo path required.

`create_release` · `post_signals` · `get_verdict` · `check_gate` · `check_gate_by_sha` · `escalate` · `record_outcome`

Full guide: [docs.useverdikt.com/agent/mcp-setup](https://docs.useverdikt.com/agent/mcp-setup) · MCP reference: [@useverdikt/mcp on npm](https://www.npmjs.com/package/@useverdikt/mcp)

## GitHub gate (branch protection)

Add the polling gate workflow to enforce merge via branch protection.

- Example workflow: [docs/examples/verdikt-gate-gha.yml](docs/examples/verdikt-gate-gha.yml)
- Setup guide: [docs.useverdikt.com/github/gate-workflow](https://docs.useverdikt.com/github/gate-workflow)

| `action` | Meaning |
| --- | --- |
| `merge` | Certified — safe to merge |
| `collecting` | Waiting for required signals (grace period) |
| `self_heal` | Threshold failure — fix and re-run |
| `escalate` | Needs human override |

## Repository layout

| Path | Purpose |
| --- | --- |
| `frontend/` | React SPA (Vite) — [useverdikt.com](https://useverdikt.com) |
| `backend/` | Express API, verdict engine, webhooks, PostgreSQL |
| `mcp/` | MCP server for agent runtimes |
| `shared/` | Signal config shared across frontend and backend |
| `supabase/` | Auth migrations and RLS |
| `docs-site/` | Mintlify source — [docs.useverdikt.com](https://docs.useverdikt.com) |
| `docs/examples/` | GHA gate workflow, CI webhook examples |

## Quick start (local development)

```bash
# 1. Configure environment
cp backend/.env.example backend/.env
# Set DATABASE_URL and other required vars — see backend/.env.example

# 2. Install and run
npm install --prefix backend
npm install --prefix frontend
npm run dev
```

API on `http://127.0.0.1:8787` · SPA on `http://127.0.0.1:5174`

## Testing

```bash
npm test                  # all tests
npm run test:backend      # backend (PostgreSQL required — see backend/README.md)
npm run test:frontend     # frontend unit tests
npm run test:e2e          # Playwright e2e (run npx playwright install once)
```

## Documentation

- [docs.useverdikt.com](https://docs.useverdikt.com) — partner and developer docs
- [backend/README.md](backend/README.md) — API reference, auth, webhooks, env vars
- [supabase/README.md](supabase/README.md) — RLS, auth linkage, local stack
- [docs.useverdikt.com/agent/mcp-setup](https://docs.useverdikt.com/agent/mcp-setup) — partner MCP setup · [mcp/README.md](mcp/README.md) — maintainer reference (in repo)
- [docs/DOGFOOD_RUNBOOK.md](docs/DOGFOOD_RUNBOOK.md) — certify and incident-flow dogfood on useverdikt/Verdikt

## Contributing

Branch from `main`, keep PRs focused, run `npm test` before opening one. All PRs go through the Verdikt gate before merge. Never commit `.env` files or secrets.

## Get access

[useverdikt.com](https://useverdikt.com) — closed beta; design partners onboarding now.
