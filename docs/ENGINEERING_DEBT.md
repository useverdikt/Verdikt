# Engineering debt tracker

Parallel hygiene track — triage in dedicated PRs; link PRs here when closed.

## Active items

_None — all tracked items addressed in chore/engineering-debt PR._

## Dependabot

See [DEPENDABOT_TRIAGE.md](./DEPENDABOT_TRIAGE.md). Weekly grouped minor/patch PRs are enabled; major bumps need manual review.

## Done

| Area | Resolution | PR |
|------|------------|-----|
| Frontend | Split workspace sync deps from `appMainLogic.js` → `lib/workspaceStorage`, `workspaceDefaults`, `releaseMappers`, `trendChart` | chore/engineering-debt |
| Backend | Background worker tier — `worker.js` + `jobs/bootstrap.js`; `RUN_BACKGROUND_JOBS=0` on API when worker runs separately | chore/engineering-debt |
| Database | RLS helpers + baseline/post-baseline/GitHub policies (`025`, `026`) | chore/engineering-debt |
| MCP | `@useverdikt/mcp@0.1.2` — documents `get_regression_history` + `get_calibration_suggestions` | chore/engineering-debt |
| UI | Removed dead `intel.alignment.teaches` from ReleaseDetail | chore/engineering-debt |
| Calibration | Dismiss persistence via `threshold_suggestion_dismissals` table | chore/engineering-debt |
| Calibration UI | Auto-apply toggle on `/thresholds` | #134 |
| Gate | Calibration context on `check_gate` | #133 |
| Prod loop | Thresholds inbox (suggest-only default) | #132 |
| Trust | Slack verdict delivery, escalation E2E | #131 |

## Future (not in original debt list)

- Signal/verdict domain split from `appMainLogic.js` (~600 lines remaining)
- Integration pull job queue (Phase B worker — async `POST .../sources/pull`)
- Full RLS on every baseline table (core + post-baseline covered; remainder low-risk via app-layer)
