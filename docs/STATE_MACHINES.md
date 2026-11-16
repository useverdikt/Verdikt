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
| `shipped_without_certification` 0 | 1 | the same promotion, when it lands on main and the gate's policy blocked merge: the **locked** status is not cert-like, or (status unchanged since the policy read) strict mode or remediation debt blocked an override (`bypass_reason` in the audit) | same | set once; never cleared. A missing snapshot is not a bypass |

Invariants:

- **D1. Promotion is once per release.** A redelivered merge event must not re-audit, resend the Slack bypass alert, reset the production monitoring window (§9), or recompute the bypass flag from a later status (for example revoked after a certified merge).
- **D2. Bypass is judged at merge time** from the status under the lock, not the status of the webhook's stale row.

A merge into `main`, `master`, `production` or `prod` (`PROD_BASE_BRANCHES` in `webhooks.js`) promotes to `environment = "prod"` with bypass bookkeeping and a monitoring window; any other base branch becomes that branch's environment. A redelivered label on a release whose verdict is locked skips the integration pull (`integration_pull: "skipped_verdict_locked"` on the response).

---

## 3. Release identity and idempotency claims (implicit)

`webhook_events(idempotency_key PK, release_id)` maps an identity key to a release.

| Source | Key shape |
|---|---|
| Any open with a commit SHA (GitHub label / `synchronize`, `POST /releases` / MCP `create_release`, CI webhook) | `release:{ws}:sha:{S}` (`buildCanonicalReleaseKey`) |
| Open without a SHA | caller `idempotencyKey`, or none (every call opens a new release) |
| Legacy, before canonical keys (still in `webhook_events`) | `github:{owner}/{repo}:pr:{N}:sha:{S}:label:{L}`, `release:{ws}:{owner}/{repo}:pr:{N}:sha:{S}` |

States per key: absent → claimed (release id bound, in the release-insert transaction) → reused (later opens return the bound release).

`openReleaseSession` claims the canonical key, then, before inserting, looks for any release in the workspace with the same commit (`findReleaseForCommit`, prefix-aware, COLLECTING first then newest). A hit rebinds the claim to that release and returns `reused: true`; this covers legacy-keyed releases and short/long SHA forms.

Invariants:

- **I1.** Same key → exactly one release (claim and insert share a transaction; a contention loser polls).
- **I2.** A SHA-bearing gate lookup never falls back to a different SHA.
- **I3.** One release per workspace + commit across the label trigger, `create_release`, and the CI webhook, including when they race. Revoked releases keep the commit (§1 R3).
- **I4.** Merge promotion matches the merged head commit as well as the PR number, so a commit opened from another PR in the same repo is promoted.

Residual (accepted): two *concurrent* first opens that pass different-length forms of the same SHA (a 7-character prefix and the full SHA) claim different keys and can both insert. Sequential opens are caught by the commit lookup. Historical duplicates are left as they are; merging them would rewrite recorded evidence.

---

## 4. Gate action (derived)

`computeGateAction` in `releaseIdentity.js`. Checks run in this order; the first match wins.

| # | Condition | Action |
|---|---|---|
| 1 | status `CERTIFICATION_REVOKED` | `revoked` |
| 2 | `gateAllowed` and status cert-like | `merge` |
| 3 | status cert-like and snapshot missing | `recover_certification` |
| 4 | `COLLECTING` within the 60 s grace period | `collecting` |
| 5 | `COLLECTING` after grace | `self_heal` |
| 6 | blocked by remediation debt | `recover_certification` |
| 7 | strict mode blocks a `CERTIFIED_WITH_OVERRIDE` (not a corroborated emergency) | `recover_certification` |
| 8 | prod `UNCERTIFIED` (ingest locked) | `escalate` (blocker `prod_locked`) |
| 9 | missing required signals | `self_heal` |
| 10 | `UNCERTIFIED` with blocking signals | `escalate` |
| 11 | anything else | `self_heal` |

`gateAllowed`, `strictBlocked`, and `blockedByRemediationDebt` come from `computeGateAllowance` (`gateAllowance.js`), shared with merge promotion (§2). `exit_code` is `gateAllowed ? 0 : 1` (`releaseGate.js`), so it is 1 for every blocked state.

Invariants:

- **G-1.** A blocked action names a step that can succeed: `self_heal` is only returned when signal ingest is open (rows 7–8 cover the locked cases).
- **G-2.** `COLLECTING` is decided before remediation debt (rows 4–6), because a collecting release that certifies cleanly is what clears the debt.

Remaining design choice: `UNCERTIFIED` under remediation debt returns `recover_certification` (row 6), which hides `escalate`; an override would still be blocked by the debt.

---

## 5. Certification snapshots (implicit)

`certification_snapshots` (one row per release) plus the durable retry queue `certification_snapshot_retries` and boot backfill claims.

| From | To | Trigger | Code | Guard |
|---|---|---|---|---|
| absent | present (`status_at_verdict` = verdict) | every verdict commit, in the verdict transaction | `domain.js` → `certificationSnapshots.persistCertificationSnapshot({ tx })` | release row lock; a failed write rolls back the verdict |
| present, **not** cert-like | replaced | a later verdict (for example pre-prod `UNCERTIFIED` → `CERTIFIED`) | `certificationSnapshots.persistCertificationSnapshot` | `ON CONFLICT ... DO UPDATE ... WHERE status_at_verdict NOT IN (cert-like)` |
| present, cert-like | unchanged | any later non-override persist | same | the WHERE clause above |
| present | replaced | override (`allowUpdate`), in the override transaction | `releaseOverride.applyReleaseOverrideDbWrites` | release row lock; status was not revoked; a failed write rolls back the override |
| persist failed | queued retry (attempt 1..4, backoff 0/2/10/30 s) | persist error on the non-transactional path (`enqueueCertificationSnapshotPersist`, used by the boot backfill) | `certificationSnapshotRetry.enqueueRetryJob` | upsert; clears any claim (invariant 19 in `AGENT_CONTEXT`) |
| queued | claimed → deleted / requeued / exhausted | retry sweep | `certificationSnapshotClaims.js` | owner-scoped lease |

Invariants:

- **S1.** The first cert-like snapshot is frozen. Revoke never touches it.
- **S2.** A cert-like release's snapshot status matches its verdict, so `verdikt-verify` engine replay reproduces the recorded status. (This was violated before: a pre-prod release that went `UNCERTIFIED` → `CERTIFIED` kept the `UNCERTIFIED` evidence.)

- **S3.** A verdict or override commits together with its snapshot. The boot backfill only covers releases certified before this held.

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
| (none) | `pending` | verdict, override, or revoke transaction | `outboundEffectOutbox.enqueuePostVerdictOutbox` | unique `idempotency_key` (`release:effect:status:verdict_issued_at`; revoke uses the revoke timestamp; primary re-evaluations with the same status append `:at:<commit time>`). `envelope_json.mode` records the enqueue mode |
| `pending`, `retry` (due) or expired `processing` | `processing` | worker claim, filtered to rows of the processor's mode (rows with no stored mode are shadow) | `outboundEffectShadowWorker.claimDueOutboundEffects` | `SKIP LOCKED`, lease, per-batch owner token |
| expired `processing` at the attempt cap, or with `delivery_started_at` set | `dead_letter` | claim pre-step (worker crashed or hung) | same | `FOR UPDATE SKIP LOCKED`; `*_EXHAUSTED` audit in the same transaction |
| `processing` | `shadow_matched` / `shadow_mismatch` / `shadow_skipped` / `shadow_unverifiable` | shadow compare | same | `claimed_by = me` |
| `processing` | `processing` (+`delivery_started_at`, lease renewed) | primary, just before the network send | `outboundEffectPrimaryWorker.beginPrimarySend` | `claimed_by = me AND claimed_until > NOW()`; no row → no send |
| `processing` | `delivered` | primary send succeeded, skipped (no target, superseded by a newer delivered row) | `outboundEffectPrimaryWorker.js` | `claimed_by = me` |
| `processing` | `retry` / `dead_letter` | error before any send, below / at max attempts | shadow worker `retryOrDeadLetter` | `claimed_by = me`; audit only when the row changed |
| `processing` | `dead_letter` | primary error after the send started (never retried) | `outboundEffectPrimaryWorker.js` | `claimed_by = me`; audit only when the row changed |
| `shadow_unverifiable`, `dead_letter` | `pending` | legacy delivery observed later | `outboundEffectLegacyObservation.js` | `legacy_observed_at IS NULL` |

Invariants: each effect is sent at most once; shadow mode never sends network traffic; primary stays off in production until the readiness window passes.

Primary delivers the row's `verdict_status` and `verdict_issued_at`, not the release's current status. The sweep runs both processors each tick (rows keep the semantics of the mode they were enqueued in, so switching `OUTBOX_MODE` never re-sends shadow rows or drops primary rows) and skips a tick while the previous one is still running. Shadow mode marks revoke rows (`source = 'revoke'`) `shadow_skipped` with reason `no_legacy_revoke_delivery`, because legacy never delivers a revoke.

---

## 8. Collection sweep claims (implicit lease)

`collection_sweep_claims`, mode `COLLECTION_SWEEP_CLAIM_MODE` = `off` / `observe` (default) / `enforce`.

| From | To | Code | Guard |
|---|---|---|---|
| absent or expired | active (attempt +1) | `collectionSweepClaims.claimDueCollectionReleases` (enforce only) | release `COLLECTING` and due, `FOR UPDATE SKIP LOCKED`, `attempt_count` below the cap (10) |
| expired at the cap | parked (never reclaimed) | same | delete the claim row to retry; removed when the release leaves `COLLECTING` |
| active | deleted | `completeCollectionSweepClaim` | owner |
| active | active + `last_error` | `recordCollectionSweepClaimFailure` | owner |
| any, release not `COLLECTING` | deleted | claim-transaction cleanup | status |

The verdict itself is protected by the release row lock (§1). The sweep passes `expectedStatus: "COLLECTING"`, so the commit re-checks under that lock that the release is still collecting; a second sweep that loaded the same row (any mode, including `observe`) skips instead of committing a duplicate verdict.

---

## 9. VCS monitoring windows (explicit)

`vcs_monitoring_windows.status`: `pending`, `scanning`, `complete`, `error`, `no_vcs`, `no_sha`. Leases: `vcs_monitor_sweep_claims`.

| From | To | Code | Guard |
|---|---|---|---|
| (none) | `pending` / `no_sha` | post-verdict effects; prod route | `ON CONFLICT DO NOTHING` |
| any | `pending` (window reset) | `vcsMonitor.refreshMonitoringWindowForProd` on a real prod promotion (§2) | promotion CAS (redelivery no longer resets) |
| `pending` / `scanning` | claimed | `vcsMonitorSweepClaims.js` | status, rescan gap, lease, claim `attempt_count` below the cap (10) |
| claimed | `scanning` / `complete` / `error` / `no_vcs` | `vcsMonitor.js` `markWindow` and the failure update | `monitoring_start` equals the scanned window's (ms precision); otherwise the scan returns `superseded` and ingests nothing |
| closed window, retryable provider failure | `error` ("retry limit reached") | `vcsMonitor.scanWindow` | `scan_count` reaches `VCS_MONITOR_MAX_SCANS` (48) |
| `no_vcs` / `error` (ended within 30 days, has SHA) | `pending`, `scan_count = 0` | `vcsWriteback.setVcsIntegration` | integration saved |

Ingest keys are `vcs_<release>_<window start ms>_final` or `..._interim_<scan_count>`, so a refreshed window and each interim scan record their own observations.

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

States: issued → used (`used_at`), superseded (`used_at` set by a newer forgot-password request), or expired. Issuing supersedes earlier tokens and inserts the new one in one transaction under the user row lock, so at most one token is valid. Consumption is a CAS `used_at IS NULL` in the same transaction as the password update, so one token changes the password at most once.

### API keys

active → revoked (`revoked_at`), CAS on `revoked_at IS NULL`. Auth filters `revoked_at IS NULL`. Only the request that changed the row writes `API_KEY_REVOKED`; a repeat returns `already_revoked: true`.

---

## 11. Signal ingest idempotency (implicit)

Per `(release_id, signal_id, idempotency_key)`: absent → inserted (`INSERT ... ON CONFLICT DO NOTHING RETURNING id`). A duplicate is replayed read-only before the lock check. A zero-row insert with a key is a race loser and is replayed read-only, with no audit and no evaluation. See `AGENT_CONTEXT` "Signal ingest & idempotency".

Locked releases (`releaseVerdictLockedAgainstIngest`) take no new signals. Routes check up front, and every write path re-checks under `FOR SHARE` on the release row inside its insert transaction: `signalIngest.ingestReleaseSignals` (409, same body as the route check), source pulls (`release_locked`), CSV apply (rows skipped as `release_locked`), and CSV replace/delete (`signalSourceCleanup`) keep a locked release's rows, because they are its certified evidence.

---

## 12. Threshold suggestions (derived)

There is no state column. A suggestion is hidden when its id, `signal:direction:source`, or `signal:direction:any` appears in dismissals or recent APPLIED/DISMISSED audits. `calibration_mode=auto_apply` uses the same filter, so it never applies a dismissed suggestion or re-applies a signal+direction it already applied. `applyThresholdSuggestion` locks the threshold row, reads after the lock, updates only the bound being changed, and audits in the same transaction.

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
| E2 | Label redelivery re-runs the integration pull and audit | `webhooks.js` schedules the pull on `reused`. Test: *E2: a redelivered label on a locked release…* | Fixed (#328), reproduced |
| E3 | A `production`/`prod` base branch becomes prod without bypass bookkeeping or a monitoring window | `becomingProd` required `main`/`master`. Test: *E3: merging into a production branch…* | Fixed (#328), reproduced |
| E4 | Merges the gate blocked are not flagged as shipped without certification: strict-mode `CERTIFIED_WITH_OVERRIDE`, a certified release missing its snapshot, `CERTIFIED_WITH_OVERRIDE` under remediation debt | `bypassAtMerge = becomingProd && !isCertLikeStatus(status)` in `releaseEnvironment.js` used status, not the gate decision. Now uses `loadMergePolicyAllowance` (strict mode, remediation debt); a missing snapshot is deliberately excluded because it is a transient evidence gap and would open remediation debt. Tests in `gateActionTransitions.test.js` | Fixed, reproduced (policy cases) |
| E5 | `POST /releases` on reuse echoes the request (`environment: "pre-prod"`, request `version`/`release_type`/`callback_url`), so a reused prod release reads as pre-prod and a new callback URL looks registered but is not stored | `workspaceReleases.js` response body. Test: *POST /releases reuse describes the stored release* | Fixed, reproduced |

### Issue F: duplicate releases for one commit (P1, fixed, #324)

| ID | Defect | Evidence | Status |
|---|---|---|---|
| F1 | Label plus `create_release` for the same SHA creates two releases (different identity keys); the gate prefers the COLLECTING one, so a certified commit can read `collecting`, and merge promotes both | Key shapes in §3. Tests in `releaseIdentityCanonical.test.js`: *create_release after the label trigger reuses the label's release* and the reverse | Fixed, reproduced |
| F2 | A label racing a CI webhook (or `create_release`) can create two releases | The CI webhook resolves by SHA before either commits. Test: *concurrent label, create_release, and CI webhook opens create one release* | Fixed, reproduced |
| F3 | The label key omitted the workspace, so after a repo moved workspaces, relabeling an old commit returned the old workspace's release | `github:{owner}/{repo}:...` key in `webhooks.js` | Fixed (canonical key includes the workspace) |

The fix uses one canonical key per workspace + commit plus a commit lookup for releases opened before canonical keys (§3 I3, I4).

### Issue G: gate action fall-through (P2, fixed, #325)

| ID | Defect | Evidence | Status |
|---|---|---|---|
| G1 | Strict-mode `CERTIFIED_WITH_OVERRIDE` → `self_heal` (unfixable; ingest is locked) | Fell through to the last row. Now `recover_certification` with a strict-mode note. Test: *strict-mode override returns recover_certification* | Fixed, reproduced |
| G2 | `COLLECTING` under remediation debt → `recover_certification`, so GHA fails on the first poll | Debt was checked before `COLLECTING`. Test: *a collecting release under remediation debt keeps collecting* | Fixed, reproduced |
| G3 | Prod `UNCERTIFIED` with missing signals (or no live failures) → `self_heal` (unfixable) | Prod ingest lock. Now `escalate` with a `prod_locked` blocker. Test: *a production UNCERTIFIED release with missing signals escalates* | Fixed, reproduced |

No new action values: each case maps to an existing action whose meaning matches, so GHA and MCP clients keep working. MCP guidance (`gateFormat.js`) gained strict-mode and prod-locked wording, and the inaccurate `do_not_use_exit_code_alone` example was corrected (package `0.1.5`).

### Issue H: outbox must be fixed before `OUTBOX_MODE=primary` (P2, fixed, #326)

All tests below are in `backend/test/outboxDeliveryGuarantees.test.js` unless noted. Migration 050 adds `delivery_started_at`.

| ID | Defect | Mode |
|---|---|---|
| O1 | Finalize checks the owner but not the lease; an expired and reclaimed row can be delivered twice (one worker id per process, no in-flight guard) | **Fixed**: per-batch owner token, sweep in-flight guard, and `beginPrimarySend` re-checks owner and live lease (and renews it) right before the send. Test: *O1: an overlapping batch…* |
| O2 | `OUTBOUND_EFFECT_*_EXHAUSTED` audit written even when the dead-letter update matched no row | **Fixed**: `retryOrDeadLetter` returns `ownership_lost` and writes nothing when the update changed no row |
| O3 | A row that crashes or hangs the worker is never dead-lettered (attempt cap only checked in `catch`) | **Fixed**: the claim dead-letters expired `processing` rows at the cap, with audit |
| O4 | `release_callback` with no callback URL returns `{ delivered: false }` without `skipped`, so it dead-letters | **Fixed**: returns `skipped: true, reason: no_callback_url` |
| O5 | Retries and post-send crashes resend (contradicts one-attempt delivery) | **Fixed**: an error after `delivery_started_at` is set dead-letters immediately; an expired row with `delivery_started_at` is dead-lettered ("delivery outcome unknown") instead of reclaimed. Errors before any send still retry |
| O6 | Primary delivers the release's current status, not the row's `verdict_status` | **Fixed**: delivers the row's verdict, and skips (`superseded_by_newer_verdict`) when a newer row for the same effect is already delivered |
| O7 | Revoke enqueues all effect types although no legacy path delivers them; in shadow they dead-letter and block readiness | **Fixed**: the shadow worker marks `source = 'revoke'` rows `shadow_skipped` (`no_legacy_revoke_delivery`); rows stay as primary-mode intent. Older revoke dead letters age out of the readiness window (7 days by default). Test: *skips revoke intents instead of retrying them* |
| O8 | Switching modes with a live backlog: shadow → primary redelivers rows legacy already sent (readiness blocks only on *stale* backlog); primary → shadow compares instead of sending, so the effect is lost | **Fixed**: `envelope_json.mode` stored at enqueue; each processor claims only its own rows and the sweep runs both |
| O9 | A repeat non-prod `UNCERTIFIED` verdict with different failures reuses the first `verdict_issued_at` in its key and is dropped by `ON CONFLICT` | **Fixed**: same-status re-evaluations pass `occurrence` (commit time) into the primary key; shadow keys are unchanged |

### Issue I: background sweeps (P2, fixed, #327)

Tests are in `backend/test/sweepGuarantees.test.js`.

| ID | Defect | Fix |
|---|---|---|
| C1 | `observe` (default) takes no collection claims; with more than one job-running process, two sweeps can commit the same non-prod `UNCERTIFIED` verdict and resend legacy effects | The sweep evaluates with `expectedStatus: "COLLECTING"`, re-checked under the row lock |
| C2 | No attempt cap on collection or VCS claims; a release that always throws is reclaimed forever | Claims at `attempt_count >= 10` are parked (delete the claim row to retry) |
| V1 | A VCS scan finishing after a prod promotion overwrites the refreshed window (`markWindow` has no guard) | Writes require the scanned `monitoring_start`; a stale scan returns `superseded` and skips ingest |
| V2 | Fixed `vcs_<id>_interim` / `_final` ingest keys drop later values | Keys include the window start and, for interim scans, `scan_count` |
| V3 | Retryable provider failures leave the window `scanning`, so closed windows are re-claimed every 5 minutes with no `scan_count` cap | A closed window becomes `error` ("retry limit reached") at `VCS_MONITOR_MAX_SCANS` (48) |
| V4 | `error` (401/403/404) and `no_vcs` are dead ends; the repair script only targets `complete` + `HEALTHY` | Saving a VCS integration reopens those windows (ended within 30 days) |
| S2 | Snapshot persist is not atomic with the verdict commit; recovery rebuilds from live data at boot only | The snapshot is written in the verdict transaction |
| S3 | The override re-freeze runs after the override commit; a crash leaves the pre-override snapshot | The snapshot is written in the override transaction |

### Issue J: minor and opt-in (P3, fixed, #328; also tracks E2 and E3)

Backend tests are in `backend/test/minorStateDefects.test.js`; the role test is `frontend/src/app/main/appMainLogic.roles.test.js`.

| Defect | Fix |
|---|---|
| Two concurrent forgot-password requests each invalidate then insert, leaving two valid reset tokens (each is still single-use) | Supersede + insert + audit in one transaction under the user row lock |
| Live `signals` can change after certification (ingest does not re-check the lock in its transaction; source pulls delete and reinsert). The frozen snapshot protects the gate, but the live table drifts from the certified evidence | Every signal write path re-checks the lock under `FOR SHARE` (§11); CSV replace/delete keeps locked releases' rows |
| Threshold min/max applied concurrently loses an update; calibration auto-apply ratchets a MISS floor and ignores dismissals | Row lock + single-column update; auto-apply uses the shared dismissed/applied filter |
| Repeating an API key revoke writes another audit | CAS on `revoked_at IS NULL`; audit only on change |
| Escalations inbox shows "Ack & Override" to `release_manager` (the backend returns 403), and `DEFAULT_ROLE_POLICY` lacks `org_admin`/`viewer` | Inbox uses `OVERRIDE_APPROVER_ROLES` (mirrors the backend); `org_admin` and `viewer` added, so viewers no longer see action buttons |