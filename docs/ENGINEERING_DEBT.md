# Engineering debt tracker

Parallel hygiene track — not blocking product loops. Triage in dedicated PRs; link PRs here when closed.

## Active items

| Area | Issue | Suggested PR |
|------|--------|--------------|
| Frontend | `appMainLogic.js` god-hook — split remaining workspace sync concerns | `fix/split-app-main-logic` |
| Backend | Worker tier for long-running integration pulls / VCS monitor sweeps | `chore/background-worker-tier` |
| Database | RLS coverage gaps on legacy tables; audit policy vs app-layer checks | `chore/rls-audit-pass` |
| MCP | Publish `@useverdikt/mcp` npm patch for `get_regression_history` + `get_calibration_suggestions` | `chore/mcp-npm-release` |
| UI | Dead `intel.alignment.teaches` in ReleaseDetail (never populated by backend) | `chore/remove-dead-alignment-teaches` |
| Calibration | Dismiss is audit-only — dismissed prod suggestions can reappear | `fix/calibration-dismiss-persistence` |

## Dependabot

See [DEPENDABOT_TRIAGE.md](./DEPENDABOT_TRIAGE.md). Weekly grouped minor/patch PRs are enabled; major bumps need manual review.

## Done (recent)

- Gate calibration context on `check_gate` (#133)
- Prod calibration → Thresholds inbox, suggest-only default (#132)
- Trust infra: Slack verdict delivery, escalation E2E (#131)
