# Dependabot triage

## Current posture (open alerts)

As of 2026-06-16: **54** open alerts — 2 critical, 30 high, 20 medium, 2 low.

Dependabot is configured in `.github/dependabot.yml` with weekly grouped **minor/patch** PRs per package root (`/backend`, `/frontend`, `/mcp`) and monthly GitHub Actions updates. **Semver-major** bumps are ignored by config and need explicit PRs.

## Weekly hygiene (15 min)

1. Open [Dependabot alerts](https://github.com/useverdikt/Verdikt/security/dependabot) — sort by severity.
2. Merge open grouped PRs when CI is green (`backend-minor-patch`, `frontend-minor-patch`, `mcp-minor-patch`, actions bumps).
3. For **critical/high** without an open PR: check if alert is dev-only (Playwright, test tooling) vs runtime (`express`, `pg`, React). Prioritize runtime.
4. Close alerts only after the fix is on `main` (auto-close on merge).

## Major bumps (manual)

| Ecosystem | Policy |
|-----------|--------|
| npm backend | One PR per major dep; run full `backend` test suite |
| npm frontend | One PR per major; run unit + targeted E2E |
| mcp | Patch `@modelcontextprotocol/sdk` in isolation; run `mcp` tests |
| github-actions | Low risk; merge when dogfood gate workflow still passes |

## False positives / accepted risk

Document here when an alert is intentionally deferred:

| Package | Severity | Reason | Review date |
|---------|----------|--------|-------------|
| _(none logged yet)_ | | | |

## Related

- Engineering debt: [ENGINEERING_DEBT.md](./ENGINEERING_DEBT.md)
