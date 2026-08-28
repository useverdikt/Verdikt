# PITR / audit-integrity restore drill

Prove that a database restore preserves Verdikt’s append-only audit hash chain. A restore that drops tail `audit_events` rows looks identical to tampering under `verifyAuditIntegrity`. Run this after infra changes, and at least quarterly.

## What this covers

Postgres only (`audit_events`, plus related certification evidence). App secret rotation is a separate procedure.

## Pre-drill baseline

From `backend/`:

```bash
npm run db:backup
npm run audit:verify
```

Record `total` / `ok` from the JSON output and the timestamp of the logical dump (`data/backups/verdikt-<ts>.sql`, or `BACKUP_DIR`).

## Restore (staging clone only)

Point `DATABASE_URL` at a **restored** instance — never run this against the live writer.

- **Supabase:** PITR / restore to a new branch or restore point, then use that connection string.
- **Railway / other:** snapshot restore onto a staging service.
- Logical dump: `psql "$DATABASE_URL" -f data/backups/verdikt-<ts>.sql` onto an empty database.

## Post-restore verification

```bash
# API must be able to talk to Postgres
curl -sf "$API_URL/health/ready"

cd backend
export DATABASE_URL="postgresql://…restored…"
npm run audit:verify
# optional single workspace:
# npm run audit:verify -- --workspace ws_…
```

Authenticated alternative: `GET /api/workspaces/:workspaceId/audit/integrity`.

## Pass criteria

- Process exit code `0`
- `valid === true`
- `tampered`, `broken_chain`, and `missing_hash` arrays empty
- `total` / `ok` match the pre-drill baseline within expected drift (no new writes during the restore window)

## Failure response

Stop using the restored database for governance. Inspect sample ids in the JSON. Do not fail open on certification or overrides. Escalate using `OPS_NOTIFY_EMAIL` (the verify script already pages that address when Resend is configured).

## Cleanup

Tear down the restored instance. Log drill date, operator, and exit code.

## Related

- Logical backups: `backend/README.md` (`npm run db:backup`)
- Hash chain contract: `docs/ARCHITECTURE_INVARIANTS.md`
- Ops alerts: `OPS_NOTIFY_EMAIL` + `RESEND_API_KEY` (snapshot exhaustion and integrity failures)
