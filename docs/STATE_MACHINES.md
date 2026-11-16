# State machines

Every explicit and implicit state machine in the Verdikt backend: states, invariants, transition tables, and the invalid states or transitions the code could reach. Regression tests for each fixed defect live in `backend/test/stateMachineTransitions.test.js` and `backend/test/lifecycleTransitions.test.js` (shared fixtures in `backend/test/helpers/stateMachineFixtures.js`).

**Keep this file current.** When you add a status value, a transition, a lease, or a guard, update the matching table. When you fix or find a defect, update [Reachable defects](#reachable-defects).

Conventions:

- **Guard** means the condition checked under the lock that makes the transition safe. "Stale row" means the check reads a row loaded before the transaction (from `requireReleaseAccess`, a sweep batch, and so on), which is not a guard.
- **CAS** means compare-and-set: `UPDATE ... WHERE <expected state>`, with the row count checked.
- File references are relative to `backend/src/` unless noted.

---

## 1. Release verdict status (explicit)

Column `releases.status`. Values come from `shared/releaseStatus.cjs` (`BACKEND_RELEASE_STATUSES`).

| State | Meaning | Gate action (see §4) |
|---|---|---|
| `COLLECTING` | Cert window open; required signals still missing | `collecting` / `self_heal` |
| `UNCERTIFIED` | Verdict issued with failed or missing signals | `escalate` / `self_heal` |
| `CERTIFIED` | Verdict issued, all checks passed | `merge` |
| `CERTIFIED_WITH_OVERRIDE` | A human approved an override | `merge` (policy permitting) |
| `CERTIFICATION_REVOKED` | A human revoked a cert-like verdict. **Terminal.** | `revoked` |

### Invariants

1. **R1. Single writer per row.** Every status write takes `SELECT ... FOR UPDATE` on the release row and re-checks the source state under that lock. No status write may be decided only from a stale row.
2. **R2. Cert-like is final for the engine.** The verdict engine never writes a `CERTIFIED`, `CERTIFIED_WITH_OVERRIDE`, or `CERTIFICATION_REVOKED` row, and never writes a prod-environment `UNCERTIFIED` row (`evaluationSkipReason` in `services/domain.js`).
3. **R3. Revoked is terminal.** Nothing leaves `CERTIFICATION_REVOKED`: not the engine, not override, not escalation acknowledge-and-override. Recertifying needs a new commit, because the same SHA reuses the revoked release's identity key (§3).
4. **R4. `verdict_issued_at` is set once** (`COALESCE`) by the first verdict or override and is never cleared.
5. **R5. The collection deadline that decides a verdict is the stored one** read under the row lock, never the caller's copy.
6. **R6. Delivery intent and audit commit with the status.** The outbox rows (§7) and audit events for a transition are written in the same transaction as the status change.

### Transition table

| From | To | Trigger | Code | Guard (under row lock) |
|---|---|---|---|---|
| (none) | `COLLECTING` | label `verdikt:rc`, `synchronize`, CI webhook, `POST /releases`, MCP `create_release` | `releaseIdentity.js` `openReleaseSession` | idempotency claim in the same transaction (§3) |
| `COLLECTING`, `UNCERTIFIED` (non-prod) | `COLLECTING` | ingest while required signals are missing and the stored deadline is open | `domain.js` `evaluateReleaseAfterSignalIngest` (collecting branch) | `evaluationSkipReason(locked) == null` |
| `COLLECTING`, `UNCERTIFIED` (non-prod) | `CERTIFIED` / `UNCERTIFIED` | ingest, integration pull, CSV import, deadline sweep | `domain.js` verdict commit | `evaluationSkipReason(locked) == null`, and if signals are missing, the stored deadline has passed |
| `COLLECTING`, `UNCERTIFIED` (any env) | `CERTIFIED_WITH_OVERRIDE` | `POST /releases/:id/override`, escalation acknowledge-and-override | `releaseOverride.js` `applyReleaseOverrideDbWrites` | `overrideRejection(locked.status) == null` |
| `CERTIFIED`, `CERTIFIED_WITH_OVERRIDE` | `CERTIFICATION_REVOKED` | `POST /releases/:id/revoke-certification` | `releaseRevoke.js` | `revokeRejection(locked.status) == null` |

Explicitly **rejected** (with HTTP status):

- Override of `CERTIFIED` or `CERTIFIED_WITH_OVERRIDE`: 400.
- Override of `CERTIFICATION_REVOKED`: 409.
- Revoke of a non-cert-like or already-revoked release: 400.
- Deadline extension when the locked row is not `COLLECTING`: 409.

Notes:

- `COLLECTING` → `CERTIFIED_WITH_OVERRIDE` (override before the evidence is complete) is allowed by the backend. The UI offers override only for pre-prod `UNCERTIFIED` (`frontend/src/lib/releaseStatus.js` `canOfferOverride`). This is a known UI/API asymmetry, not a defect.
- A prod `UNCERTIFIED` → `CERTIFIED_WITH_OVERRIDE` override is a *retroactive override* and writes `RETROACTIVE_OVERRIDE_AFTER_BYPASS_MERGE`.
- When an evaluation is skipped because a concurrent writer already decided the release, `ingestReleaseSignals` answers with the read-only current state plus `evaluation_skipped: true` (it used to return `null`, which made the route throw a 500).

### Side transitions

| Field | Transition | Code | Guard |
|---|---|---|---|
| `collection_deadline` | extend (bounded by 120 minutes per call, 24 hours from now) | `collectionDeadline.js` | locked row is `COLLECTING`; audit in the same transaction |
| pending escalations (§6) | auto-resolve | `escalationResolution.js`, called from the verdict commit (`CERTIFIED`) and override transactions | same transaction as the cert-like status |

---

## 2. Release deployment lifecycle (implicit)

Fields: `releases.environment`, `shipped_without_certification`, `shipped_without_certification_at`. These record what is live; `status` records what was approved.

| From | To | Trigger | Code | Guard |
|---|---|---|---|---|
| `pre-prod` (or any env ≠ target) | `prod` (base `main`/`master`) or base branch name | GitHub `pull_request.closed` with `merged=true`, head SHA matches | `routes/webhooks.js` → `releaseEnvironment.js` `promoteReleaseOnMerge` | locked `environment` differs from the target (CAS); otherwise no-op `already_promoted` |
| `shipped_without_certification` 0 | 1 | the same promotion, when it lands on main and the **locked** status is not cert-like | same | set once; never cleared |

Invariants:

- **D1. Promotion is once per release.** A redelivered merge event must not re-audit, resend the Slack bypass alert, reset the production monitoring window (§9), or recompute the bypass flag from a later status (for example revoked after a certified merge).
- **D2. Bypass is judged at merge time** from the status under the lock, not the status of the webhook's stale row.

Open gaps (not fixed here, see [Reachable defects](#reachable-defects)):

- A merge to a base branch named `production`/`prod` gets `environment = "production"`. That counts as prod for `isProdEnvironment`, but `becomingProd` requires `main`/`master`, so no bypass bookkeeping or monitoring window is created.
- Label redelivery re-runs the integration pull and writes another `SIGNAL_SOURCES_PULL` audit.

---

## 3. Release identity and idempotency claims (implicit)

`webhook_events(idempotency_key PK, release_id)` maps an identity key to a release.

| Source | Key shape |
|---|---|
| GitHub label / `synchronize` | `github:{owner}/{repo}:pr:{N}:sha:{S}:label:{L}` |
| `POST /releases` / MCP `create_release` | `release:{ws}:{owner}/{repo}:pr:{N}:sha:{S}` |

States per key: absent → claimed (release id bound, in the release-insert transaction) → reused (later opens return the bound release).

Invariants:

- **I1.** Same key → exactly one release (claim and insert share a transaction; a contention loser polls).
- **I2.** A SHA-bearing gate lookup never falls back to a different SHA.

Open gap: the label key and the `create_release` key differ for the same commit, so labeling **and** calling `create_release` (which the MCP instructions present as alternatives) creates two releases for one SHA. A label racing a CI webhook can also create two.

---

## 4. Gate action (derived)

`computeGateAction` in `releaseIdentity.js`. Checks run in this order; the first match wins.

| # | Condition | Action |
|---|---|---|
| 1 | status `CERTIFICATION_REVOKED` | `revoked` |
| 2 | `gateAllowed` and status cert-like | `merge` |
| 3 | status cert-like and snapshot missing | `recover_certification` |
| 4 | blocked by remediation debt | `recover_certification` |
| 5 | `COLLECTING` within the 60 s grace period | `collecting` |
| 6 | `COLLECTING` after grace | `self_heal` |
| 7 | missing required signals | `self_heal` |
| 8 | `UNCERTIFIED` with blocking signals | `escalate` |
| 9 | anything else | `self_heal` |

`exit_code` is `gateAllowed ? 0 : 1` (`releaseGate.js`). Open gaps in this table:

- `CERTIFIED_WITH_OVERRIDE` under strict mode (not an emergency) falls through to row 9 (`self_heal`), but ingest is locked, so self-heal cannot succeed.
- `COLLECTING` under remediation debt hits row 4 first, so GHA fails on its first poll before the clean release that would clear the debt can certify.
- Prod `UNCERTIFIED` with missing signals gets `self_heal`, but prod ingest is locked.

---

## 5. Certification snapshots (implicit)

`certification_snapshots` (one row per release) plus the durable retry queue `certification_snapshot_retries` and boot backfill claims.

| From | To | Trigger | Code | Guard |
|---|---|---|---|---|
| absent | present (`status_at_verdict` = verdict) | every verdict commit, synchronously after commit | `domain.js` → `certificationSnapshotRetry.enqueueCertificationSnapshotPersist` | none |
| present, **not** cert-like | replaced | a later verdict (for example pre-prod `UNCERTIFIED` → `CERTIFIED`) | `certificationSnapshots.persistCertificationSnapshot` | `ON CONFLICT ... DO UPDATE ... WHERE status_at_verdict NOT IN (cert-like)` |
| present, cert-like | unchanged | any later non-override persist | same | the WHERE clause above |
| present | replaced | override (`allowUpdate`) | `releaseOverride.runOverrideSideEffects` | override committed; status was not revoked |
| persist failed | queued retry (attempt 1..4, backoff 0/2/10/30 s) | persist error | `certificationSnapshotRetry.enqueueRetryJob` | upsert; clears any claim (invariant 19 in `AGENT_CONTEXT`) |
| queued | claimed → deleted / requeued / exhausted | retry sweep | `certificationSnapshotClaims.js` | owner-scoped lease |

Invariants:

- **S1.** The first cert-like snapshot is frozen. Revoke never touches it.
- **S2.** A cert-like release's snapshot status matches its verdict, so `verdikt-verify` engine replay reproduces the recorded status. (This was violated before: a pre-prod release that went `UNCERTIFIED` → `CERTIFIED` kept the `UNCERTIFIED` evidence.)

Open gaps: the snapshot persist is not atomic with the verdict commit (a crash in between leaves a cert-like release without a snapshot until the boot backfill rebuilds it from *live* data); the override re-freeze runs after the override commit.

---

## 6. Escalation requests (explicit)

`escalation_requests.state`: `pending_human_review` → `resolved`. Flags: `sla_breached` 0→1, `sla_reminder_sent_at` NULL→timestamp. Leases: `escalation_sla_sweep_claims`.

| From | To | Trigger | Code | Guard |
|---|---|---|---|---|
| (none) | pending | `POST /releases/:id/escalate`, MCP `escalate` (rejected for cert-like: 400, revoked: 409) | `escalations.createEscalationRequest` | `INSERT ... ON CONFLICT (release_id) WHERE state = pending DO UPDATE` (unique partial index `idx_escalations_one_pending_per_release`, migration `049`) |
| pending | pending (refreshed reason, signals) | repeat escalate | same | same upsert; keeps id and SLA clock |
| pending | resolved | acknowledge | `escalations.acknowledgeEscalation` | CAS `state = pending`; audit in the same transaction |
| pending | resolved + release override | acknowledge-and-override | `escalations.acknowledgeEscalationWithOverride` | CAS first, then the override re-checks the release under its lock; any failure rolls back both |
| pending | resolved (`system:verdict_engine` / `system:human_override`) | release becomes cert-like | `escalationResolution.resolvePendingEscalationsForRelease` | same transaction as the status change; audit `ESCALATION_AUTO_RESOLVED` |
| `sla_breached` 0 | 1 | SLA sweep | `escalations.markEscalationBreachedWithAudit` | `state = pending AND sla_breached = 0`; audit in the same transaction |
| reminder NULL | timestamp | SLA sweep after a successful send | `escalations.markEscalationReminderSent` | active claim owner and lease; a send that returns `{ ok: false }` throws and is retried on the next lease |

Invariants:

- **E1.** At most one pending escalation per release.
- **E2.** A pending escalation implies the release is not cert-like.
- **E3.** Each pending → resolved transition happens once and writes one audit event.

---

## 7. Outbound effect outbox (explicit)

`outbound_effect_outbox.state`. Mode: `OUTBOX_MODE` = `shadow` (default) or `primary`.

| From | To | Trigger | Code | Guard |
|---|---|---|---|---|
| (none) | `pending` | verdict, override, or revoke transaction | `outboundEffectOutbox.enqueuePostVerdictOutbox` | unique `idempotency_key` (`release:effect:status:verdict_issued_at`; revoke uses the revoke timestamp) |
| `pending`, `retry` (due) or expired `processing` | `processing` | worker claim | `outboundEffectShadowWorker.js` | `SKIP LOCKED`, lease |
| `processing` | `shadow_matched` / `shadow_mismatch` / `shadow_skipped` / `shadow_unverifiable` | shadow compare | same | `claimed_by = me` |
| `processing` | `delivered` | primary send | `outboundEffectPrimaryWorker.js` | `claimed_by = me` |
| `processing` | `retry` / `dead_letter` | error, below / at max attempts | shadow worker | `claimed_by = me` |
| `shadow_unverifiable`, `dead_letter` | `pending` | legacy delivery observed later | `outboundEffectLegacyObservation.js` | `legacy_observed_at IS NULL` |

Invariants: each effect is sent at most once; shadow mode never sends network traffic; primary stays off in production until the readiness window passes.

Open gaps (all block turning on `primary`; see defects O1–O6): finalize checks the owner but not the lease, so an expired-and-reclaimed row can be sent twice; the dead-letter audit is written even when the update matched no row; primary delivers the release's *current* status rather than the row's `verdict_status`; `release_callback` rows with no callback URL dead-letter. Shadow mode marks revoke rows (`source = 'revoke'`) `shadow_skipped` with reason `no_legacy_revoke_delivery`, because legacy never delivers a revoke.

---

## 8. Collection sweep claims (implicit lease)

`collection_sweep_claims`, mode `COLLECTION_SWEEP_CLAIM_MODE` = `off` / `observe` (default) / `enforce`.

| From | To | Code | Guard |
|---|---|---|---|
| absent or expired | active (attempt +1) | `collectionSweepClaims.claimDueCollectionReleases` (enforce only) | release `COLLECTING` and due, `FOR UPDATE SKIP LOCKED` |
| active | deleted | `completeCollectionSweepClaim` | owner |
| active | active + `last_error` | `recordCollectionSweepClaimFailure` | owner |
| any, release not `COLLECTING` | deleted | claim-transaction cleanup | status |

The verdict itself is protected by the release row lock (§1), so a duplicate sweep cannot write an invalid status. It can still commit a second identical non-prod `UNCERTIFIED` verdict and resend legacy post-verdict effects when more than one process runs jobs in `observe` mode (open defect C1).

---

## 9. VCS monitoring windows (explicit)

`vcs_monitoring_windows.status`: `pending`, `scanning`, `complete`, `error`, `no_vcs`, `no_sha`. Leases: `vcs_monitor_sweep_claims`.

| From | To | Code | Guard |
|---|---|---|---|
| (none) | `pending` / `no_sha` | post-verdict effects; prod route | `ON CONFLICT DO NOTHING` |
| any | `pending` (window reset) | `vcsMonitor.refreshMonitoringWindowForProd` on a real prod promotion (§2) | promotion CAS (redelivery no longer resets) |
| `pending` / `scanning` | claimed | `vcsMonitorSweepClaims.js` | status, rescan gap, lease |
| claimed | `scanning` / `complete` / `error` / `no_vcs` | `vcsMonitor.js` `markWindow` | **none** (`WHERE release_id` only) |

Open gaps: a scan that finishes after a prod promotion overwrites the refreshed window with old findings (V1); fixed interim/final ingest keys drop later values (V2); retryable provider failures loop with no cap (V3).

---

## 10. Membership and auth tokens (implicit)

### Workspace invites (`workspace_invites`)

| From | To | Code | Guard |
|---|---|---|---|
| (none) | pending | `workspaceMembers.createWorkspaceInvite` (deletes earlier pending invites for the email) | — |
| pending | accepted | `acceptWorkspaceInvite`, `registerUserWithInvite` | CAS `accepted_at IS NULL` on the invite id, in the same transaction as the membership writes and audit |
| pending | deleted (revoked or replaced) | `revokeInvite`, re-invite | `accepted_at IS NULL` |

Invariant: an invite grants membership at most once, and never after it was revoked or replaced.

### Membership (`workspace_members`, plus the legacy `users.workspace_id` / `users.role` fallback)

| From | To | Code | Guard |
|---|---|---|---|
| none | member(role) | `ensureMemberRow` | upsert |
| member | removed | `removeMember` | member rows locked `FOR UPDATE`; the last member cannot be removed; a removed user whose home is this workspace is re-homed to their oldest remaining membership, or to a new personal workspace (as `org_admin`, the same state as a fresh signup) |

Invariant: **M1.** After removal, `userHasWorkspaceAccess(user, ws)` is false. (Before, the `users.workspace_id` fallback kept full access and the old role.)

### Password reset tokens (`password_reset_tokens`)

States: issued → used (`used_at`), superseded (`used_at` set by a newer forgot-password request), or expired. Consumption is a CAS `used_at IS NULL` in the same transaction as the password update, so one token changes the password at most once.

### API keys

active → revoked (`revoked_at`). Auth filters `revoked_at IS NULL`. Repeating a revoke writes another `API_KEY_REVOKED` audit (minor, open).

---

## 11. Signal ingest idempotency (implicit)

Per `(release_id, signal_id, idempotency_key)`: absent → inserted (`INSERT ... ON CONFLICT DO NOTHING RETURNING id`). A duplicate is replayed read-only before the lock check. A zero-row insert with a key is a race loser and is replayed read-only, with no audit and no evaluation. See `AGENT_CONTEXT` "Signal ingest & idempotency".

---

## 12. Threshold suggestions (derived)

There is no state column. A suggestion is hidden when its id, `signal:direction:source`, or `signal:direction:any` appears in dismissals or recent APPLIED/DISMISSED audits. Open gaps: applying min and max concurrently loses one update (read-modify-write with no transaction), and `calibration_mode=auto_apply` ignores dismissals and ratchets a MISS floor on every new production signal.

---

## Reachable defects

Priority: **P0** breaks a security or governance guarantee; **P1** corrupts recorded evidence or state; **P2** causes wrong actions or duplicate side effects under realistic conditions; **P3** is minor or opt-in.

"Reproduced" means a regression test failed against the pre-fix code and passes now. "Code-read" means the path was traced in code but not reproduced by a test.

### Issue A: release status transitions bypass the row lock (P0, fixed)

| ID | Invalid state / transition | Evidence | Status |
|---|---|---|---|
| A1 | `CERTIFICATION_REVOKED` → `CERTIFIED_WITH_OVERRIDE` through override or escalation acknowledge-and-override; the override also rewrites the frozen snapshot | `applyReleaseOverride` rejected only `CERTIFIED`/`CERTIFIED_WITH_OVERRIDE`. Test: *override is rejected for a revoked release and frozen evidence is untouched* | Fixed, reproduced |
| A2 | Engine overwrites `CERTIFICATION_REVOKED` | The skip set in `evaluateReleaseAfterSignalIngest` omitted revoked; reachable when ingest passed the stale lock check before a revoke. Test: *evaluation never rewrites a revoked release* | Fixed, reproduced |
| A3 | `CERTIFIED` → `COLLECTING` | The collecting branch ran an unconditional `UPDATE` outside the row lock; a concurrent ingest's certification is overwritten while `verdict_issued_at`, the snapshot, and CERTIFIED outbox rows remain. Test: *a stale still-collecting evaluation does not reset a concurrently CERTIFIED release* (held-lock interleave) | Fixed, reproduced |
| A4 | Double override: two `override_history` rows, two `OVERRIDE_APPROVED` audits, double side effects; `CERTIFIED` → `CERTIFIED_WITH_OVERRIDE` from a stale `UNCERTIFIED` row | Stale-row check plus an unconditional update. Tests: *concurrent overrides commit exactly once*, *rejects an override built from a stale UNCERTIFIED row* | Fixed, reproduced (4/4 concurrent overrides succeeded before) |
| A5 | Double revoke: duplicate audit plus a second outbox row (the revoke key embeds a timestamp, so primary would deliver twice) | Same pattern. Test: *concurrent revokes write one audit event and one outbox intent* | Fixed, reproduced (4/4 succeeded before) |
| A6 | Verdict from a stale collection deadline (sweep vs extension) | `deadlinePassed` came from the caller's row. Test: *evaluation uses the stored deadline* | Fixed, reproduced |
| A7 | Deadline extended (with audit) on an already verdicted release | Stale-row check. Test: *extension is rejected once the release has left COLLECTING* | Fixed, reproduced |
| A8 | Ingest returns HTTP 500 after successfully storing signals when a concurrent writer already decided the release | `out.idempotency_key = ...` on `null`. Test: *returns the current verdict when a concurrent writer already certified the release* | Fixed, reproduced |

### Issue B: membership and auth tokens are not single-use (P0, fixed)

| ID | Defect | Evidence | Status |
|---|---|---|---|
| B1 | A removed member keeps access and role in the workspace | `removeMember` deleted only `workspace_members`; `userHasWorkspaceAccess` / `getEffectiveRoleForWorkspace` fall back to `users.workspace_id`/`role`. Tests under *workspace member removal revokes access* | Fixed, reproduced |
| B2 | Two admins removing each other leave zero members | Count check and delete were separate statements | Fixed, reproduced |
| B3 | An invite revoked while acceptance is in flight still grants membership; concurrent accepts duplicate the audit | No transaction; the final `UPDATE` had no `accepted_at IS NULL` guard | Fixed, reproduced |
| B4 | One password-reset token changes the password twice; a superseded token still completes | `used_at` set `WHERE id` only, after bcrypt | Fixed, reproduced |

### Issue C: certification evidence freezes the wrong verdict (P1, fixed)

| ID | Defect | Evidence | Status |
|---|---|---|---|
| C1 | A pre-prod release that goes `UNCERTIFIED` → `CERTIFIED` keeps the UNCERTIFIED snapshot; the gate, the cert signature, and the `verdikt-verify` replay use failing evidence for a certified verdict | Persist was `ON CONFLICT DO NOTHING`. Test: *an UNCERTIFIED-era snapshot is replaced when the release later certifies* | Fixed, reproduced |

### Issue D: escalation lifecycle (P1, fixed)

| ID | Defect | Evidence | Status |
|---|---|---|---|
| D1 | Concurrent `escalate` calls create several pending escalations (duplicate emails and reminders) | Check-then-insert, non-unique index. Migration `049` dedupes and adds a unique partial index | Fixed, reproduced (5/5 created before) |
| D2 | Concurrent acknowledgements double-resolve and double-audit; acknowledge-and-override can override after a plain acknowledgement | No state guard on the update | Fixed, reproduced |
| D3 | An escalation stays pending after the release is overridden directly or certifies; the SLA sweep then breaches it and emails reminders, and acknowledge-and-override fails | No link from status transitions to escalations | Fixed, reproduced |
| D4 | A failed SLA reminder email is marked sent and never retried | Email helpers return `{ ok: false }`; the result was ignored | Fixed, reproduced |

### Issue E: merge webhook redelivery is not idempotent (P1, fixed for promotion)

| ID | Defect | Evidence | Status |
|---|---|---|---|
| E1 | Redelivery re-audits, resends the Slack bypass alert, and resets the prod monitoring window (wiping its findings); after a revoke it flags a certified merge as shipped without certification | No CAS on `environment`; bypass computed from the current status. Test: *a redelivered merge event after a revoke does not re-flag a bypass* | Fixed, reproduced |
| E2 | Label redelivery re-runs the integration pull and audit | `webhooks.js` schedules the pull on `reused` | Open, code-read (P3) |
| E3 | A `production`/`prod` base branch becomes prod without bypass bookkeeping or a monitoring window | `becomingProd` requires `main`/`master` | Open, code-read (P2) |
| E4 | Merges the gate blocked are not flagged as shipped without certification: strict-mode `CERTIFIED_WITH_OVERRIDE`, a certified release missing its snapshot, `CERTIFIED_WITH_OVERRIDE` under remediation debt | `bypassAtMerge = becomingProd && !isCertLikeStatus(status)` in `releaseEnvironment.js` uses status, not the gate decision | Open, code-read (P2, tracked in #325) |
| E5 | `POST /releases` on reuse echoes the request (`environment: "pre-prod"`, request `version`/`release_type`/`callback_url`), so a reused prod release reads as pre-prod and a new callback URL looks registered but is not stored | `workspaceReleases.js` response body | Open, code-read (P3) |

### Issue F: duplicate releases for one commit (P1, open, #324)

| ID | Defect | Evidence |
|---|---|---|
| F1 | Label plus `create_release` for the same SHA creates two releases (different identity keys); the gate prefers the COLLECTING one, so a certified commit can read `collecting`, and merge promotes both | Key shapes in §3; no unique index on `releases(commit_sha)` |
| F2 | A label racing a CI webhook can create two releases | The CI webhook resolves by SHA before either commits |

The fix needs an identity decision (one canonical key per workspace + repo + SHA), not a local guard.

### Issue G: gate action fall-through (P2, open, #325)

| ID | Defect | Evidence |
|---|---|---|
| G1 | Strict-mode `CERTIFIED_WITH_OVERRIDE` → `self_heal` (unfixable; ingest is locked) | Row 9 in §4 |
| G2 | `COLLECTING` under remediation debt → `recover_certification`, so GHA fails on the first poll | Row 4 precedes row 5 |
| G3 | Prod `UNCERTIFIED` with missing signals → `self_heal` (unfixable) | Row 7; prod ingest lock |

This changes the GHA/MCP contract, so it should land as its own reviewed change.

### Issue H: outbox must be fixed before `OUTBOX_MODE=primary` (P2, open, #326)

| ID | Defect | Mode |
|---|---|---|
| O1 | Finalize checks the owner but not the lease; an expired and reclaimed row can be delivered twice (one worker id per process, no in-flight guard) | primary |
| O2 | `OUTBOUND_EFFECT_*_EXHAUSTED` audit written even when the dead-letter update matched no row | both (needs lease expiry) |
| O3 | A row that crashes or hangs the worker is never dead-lettered (attempt cap only checked in `catch`) | both |
| O4 | `release_callback` with no callback URL returns `{ delivered: false }` without `skipped`, so it dead-letters | primary |
| O5 | Retries and post-send crashes resend (contradicts one-attempt delivery) | primary |
| O6 | Primary delivers the release's current status, not the row's `verdict_status` | primary |
| O7 | Revoke enqueues all effect types although no legacy path delivers them; in shadow they dead-letter and block readiness | **Fixed**: the shadow worker marks `source = 'revoke'` rows `shadow_skipped` (`no_legacy_revoke_delivery`); rows stay as primary-mode intent. Older revoke dead letters age out of the readiness window (7 days by default). Test: *skips revoke intents instead of retrying them* |
| O8 | Switching modes with a live backlog: shadow → primary redelivers rows legacy already sent (readiness blocks only on *stale* backlog); primary → shadow compares instead of sending, so the effect is lost | cutover / rollback |
| O9 | A repeat non-prod `UNCERTIFIED` verdict with different failures reuses the first `verdict_issued_at` in its key and is dropped by `ON CONFLICT` | primary |

### Issue I: background sweeps (P2, open, #327)

| ID | Defect |
|---|---|
| C1 | `observe` (default) takes no collection claims; with more than one job-running process, two sweeps can commit the same non-prod `UNCERTIFIED` verdict and resend legacy effects |
| C2 | No attempt cap on collection or VCS claims; a release that always throws is reclaimed forever |
| V1 | A VCS scan finishing after a prod promotion overwrites the refreshed window (`markWindow` has no guard) |
| V2 | Fixed `vcs_<id>_interim` / `_final` ingest keys drop later values |
| V3 | Retryable provider failures leave the window `scanning`, so closed windows are re-claimed every 5 minutes with no `scan_count` cap |
| V4 | `error` (401/403/404) and `no_vcs` are dead ends; the repair script only targets `complete` + `HEALTHY` |
| S2 | Snapshot persist is not atomic with the verdict commit; recovery rebuilds from live data at boot only |
| S3 | The override re-freeze runs after the override commit; a crash leaves the pre-override snapshot |

### Issue J: minor and opt-in (P3, open, #328; also tracks E2, E3, and E5)

- Two concurrent forgot-password requests each invalidate then insert, leaving two valid reset tokens (each is still single-use).
- Live `signals` can change after certification (ingest does not re-check the lock in its transaction; source pulls delete and reinsert). The frozen snapshot protects the gate, but the live table drifts from the certified evidence.
- Threshold min/max applied concurrently loses an update; calibration auto-apply ratchets a MISS floor and ignores dismissals.
- Repeating an API key revoke writes another audit.
- Escalations inbox shows "Ack & Override" to `release_manager` (the backend returns 403), and `DEFAULT_ROLE_POLICY` lacks `org_admin`/`viewer`.
- MCP `do_not_use_exit_code_alone` (`mcp/src/gateFormat.js`) cites strict-mode `CERTIFIED_WITH_OVERRIDE` as an `exit_code` 0 + `self_heal` case, but `exit_code` is `gateAllowed ? 0 : 1` (`releaseGate.js`), and strict mode makes `gateAllowed` false, so that example returns 1.
