# Architecture and invariants

This is the short operating contract for Verdikt. Detailed API and deployment instructions live in `backend/README.md`; this file records the boundaries and rules that should not be weakened accidentally.

## System boundaries

- `frontend/` is the React/Vite browser application. It calls the HTTP API and does not own certification decisions.
- `backend/src/routes/` handles HTTP parsing, authentication, authorization, and response mapping.
- `backend/src/services/` owns release, signal, verdict, gate, audit, integration, and notification behavior.
- `backend/src/database/` is the PostgreSQL access layer. PostgreSQL is the source of truth.
- `backend/src/jobs/` contains bounded background sweeps. Production API replicas do not run these by default; dedicated workers do.
- `shared/` contains signal-domain constants used by both frontend and backend.
- `mcp/` is an API client for agent runtimes; it must not duplicate verdict logic.

## Certification flow

1. A release is opened against a stable identity, normally a commit SHA.
2. Signals are ingested idempotently and validated against workspace definitions.
3. The backend computes the verdict and freezes certification evidence.
4. Gate APIs translate that state to `collecting`, `merge`, `self_heal`, or `escalate`.
5. Overrides require a human session, justification, and an audit record.
6. Production outcomes can calibrate future thresholds, but auto-application remains explicit policy.

## Security and tenancy

- Every protected route must resolve both caller identity and workspace/release access. Database RLS is defense in depth; service credentials do not replace application authorization.
- Human control-plane mutations require the secure cookie session plus CSRF protection. Agent access keys are limited to explicitly audited agent operations.
- `INTERNAL_WORKSPACE_VIEWER_EMAILS` is a local/test convenience only and must be empty in production-like environments.
- `JWT_SECRET`, `CERT_SIGNING_KEY`, and webhook secrets are separate trust domains. Certification signatures must never be derived from the login secret.
- Integration and VCS credentials are encrypted at rest with AES-256-GCM through `ENCRYPTION_MASTER_KEY`.

## Data, concurrency, and background work

- Signal ingestion is idempotent. Retries must not create duplicate evidence.
- Audit rows are append-only and serialized per workspace with a PostgreSQL advisory transaction lock.
- Cross-replica release events use PostgreSQL `LISTEN/NOTIFY`; in-process events are insufficient for production coordination.
- Multi-replica rate limits require Redis. Set `API_REPLICA_COUNT` or `REQUIRE_DISTRIBUTED_RATE_LIMITS=1` so startup fails closed when `REDIS_URL` is absent.
- Sweeps query only actionable rows, use deterministic ordering, and process bounded batches. A failure for one release must not stop the remainder of the batch.

## Database changes

- Every schema change must have matching migrations in `backend/migrations/postgres/` and `supabase/migrations/`.
- Migrations are forward-only, ordered, and transactional where PostgreSQL permits.
- Run `npm run check:migrations` before merge.

## Release safety

- A successful CI run is necessary but not sufficient: protected release PRs also pass the Verdikt gate.
- Certification snapshots and signatures are immutable evidence. New records use the independent v2 signing key; legacy v1 JWT-derived records remain read-only verifiable until an explicit retirement migration removes that compatibility path.
- Public certification records are opt-in per workspace and must expose only the fields allowed by workspace policy.
