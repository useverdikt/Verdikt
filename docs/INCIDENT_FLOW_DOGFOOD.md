# Incident flow dogfood — tracker

This PR is the **VCS monitor stimulus** for post-deploy incident detection. It should **not merge to `main`** unless you are intentionally re-running certification.

Procedure: [DOGFOOD_RUNBOOK.md](DOGFOOD_RUNBOOK.md) § Incident flow dogfood (merge docs PR #171 first if that section is not on `main` yet).

## Instructions for operator

1. Confirm a **CERTIFIED** release recently merged to `main` (VCS monitor window ~120 min).
2. Add GitHub label **`incident`** to **this PR** while that window is open.
3. Watch the **merged release** in the app (not this PR's cert window) for `vcs_incident_prs` and alignment **MISS**.
4. Link this PR URL as `incident_ref` on that release's alignment row.
5. Close this PR when done — do not merge.

## Target release (fill in)

| Field | Value |
|-------|--------|
| Merged PR | |
| Release id | |
| Merge time (UTC) | |
| Monitor window ends | |

## Checklist

- [ ] Certified release merged; monitor window open
- [ ] This PR labelled **`incident`**
- [ ] VCS monitor: `vcs_incident_prs >= 1` on target release
- [ ] Alignment: **MISS** (if target was CERTIFIED)
- [ ] `incident_ref` → this PR URL
- [ ] Screenshot captured
- [ ] PR closed without merge

## Notes

<!-- API responses, release ids, screenshots -->
