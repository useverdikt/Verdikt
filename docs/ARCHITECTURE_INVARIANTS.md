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
- VCS monitoring may infer healthy production evidence only after every required provider read succeeds. Authentication/configuration failures are terminal `error` states; retryable provider failures remain `scanning`. Neither failure mode may emit production observations.

## Data, concurrency, and background work

- Signal ingestion is idempotent. Retries must not create duplicate evidence, append audits, or re-evaluate verdicts. Every push boundary, including signed CI/eval webhooks, checks duplicate replay before rejecting a verdict-locked release.
- Push-based manual, API, CI, and mapped-integration signals share `ingestReleaseSignals` for validation-aware persistence, idempotency race handling, and verdict evaluation. Routes retain authentication, release-lock errors, and response decoration. Pull/CSV replacement flows remain separate because they intentionally replace a source snapshot.
- Terminal verdict intelligence persists exact `failed_signals` and `threshold_failed_signals` arrays. Gate reads reuse threshold failures only with frozen snapshot evidence; live UNCERTIFIED gates recalculate so post-verdict threshold changes retain existing semantics. Legacy snapshots without the field also fall back safely.
- Audit rows are append-only and serialized per workspace with a PostgreSQL advisory transaction lock.
- Repeated gate polls coalesce only when the recorded result, release, actor, and agent session are unchanged. The first result, every changed result, and an unchanged five-minute heartbeat append hash-chained audit rows; compare-and-append runs under the workspace audit lock.
- Expanded frontend release detail is owned by the workspace-scoped TanStack `releaseDetail` query. The local release list may keep summary/display projections but must not become a second store for intelligence, certification, or delta detail.
- Cross-replica release events use PostgreSQL `LISTEN/NOTIFY`; in-process events are insufficient for production coordination.
- Multi-replica rate limits require Redis. Set `API_REPLICA_COUNT` or `REQUIRE_DISTRIBUTED_RATE_LIMITS=1` so startup fails closed when `REDIS_URL` is absent.
- Sweeps query only actionable rows, use deterministic ordering, and process bounded batches. A failure for one release must not stop the remainder of the batch.
- Expired collection-window work uses short PostgreSQL transactions to acquire durable, owner-scoped leases before evaluation. Never hold the claim transaction open during verdict work; failed workers recover through lease expiry. Roll out `observe` before `enforce`.
- External delivery intent is inserted into `outbound_effect_outbox` in the same transaction as the terminal verdict or human override. Each release event records only effects executed by its legacy path and uses a stable idempotency key. Shadow recording must precede any outbox-owned delivery cutover.
- Shadow outbox workers use owner-scoped leases, bounded retries, and dead letters. Shadow processing may compare database evidence but must never perform network delivery. Legacy observation writes are fail-open and store hashes/metadata rather than endpoint URLs or secrets; historical `shadow_unverifiable` rows remain non-certifying evidence.
- Outbox delivery ownership cannot advance from shadow on worker liveness alone. A 7–14 day workspace-scoped readiness window must have a meaningful eligible sample, zero mismatches/dead letters/stale backlog/failed legacy deliveries, at least 99% legacy observation coverage, and p95 comparison latency below five minutes. Payload equality never converts a non-2xx or failed legacy delivery into a match. Aggregate readiness reads never expose payloads or destinations.

## Database changes

- Every schema change must have matching migrations in `backend/migrations/postgres/` and `supabase/migrations/`.
- API and worker startup serialize migration discovery and execution with the same PostgreSQL session advisory lock. The lock is acquired before `schema_migrations` is created or read, survives each per-file transaction, and is released (or its pooled connection destroyed) on every exit path.
- Migrations are forward-only, ordered, and transactional where PostgreSQL permits.
- Run `npm run check:migrations` before merge.

## Release safety

- A successful CI run is necessary but not sufficient: protected release PRs also pass the Verdikt gate.
- A gate request containing `commit_sha` may resolve only that commit (full or matching 7+ character prefix). It must never fall back to another release for the same PR, ref, or version; CI and MCP clients fail closed when the returned SHA differs.
- Certification snapshots and signatures are immutable evidence. New records use the independent v2 signing key; legacy v1 JWT-derived records remain read-only verifiable until an explicit retirement migration removes that compatibility path.
- Public certification records are opt-in per workspace and must expose only the fields allowed by workspace policy.
