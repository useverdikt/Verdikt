# Verdict callback (`callback_url`)

**Push-based agent loop.** When an agent opens a cert window, it can register an HTTPS URL. Verdikt **POSTs a verdict payload** to that URL as soon as a verdict is issued — no polling `check_gate` required.

This is **already implemented** (`releases.callback_url`, `releaseCallback.js`). Use it for agent runners, orchestrators, or internal webhooks that should react when certification completes.

---

## When to use

| Pattern | Use when |
|---------|----------|
| **`callback_url` on `create_release`** | Agent/orchestrator owns the session and wants a push when ready |
| **Poll `check_gate`** | Simple scripts, or when no receiver endpoint exists |
| **GHA gate workflow** | Enforcing merge at GitHub — see `verdikt-gate-gha.yml` |
| **Workspace outbound webhook** (Settings → Governance) | One URL for **all** releases in the workspace, HMAC-signed, delivery log |

`callback_url` is **per release**, unsigned, and agent-oriented. The workspace outbound webhook is org-wide CI integration with signing.

---

## Register a callback

### MCP (`create_release`)

```javascript
create_release({
  version: "Add agentic layer (#34)",
  commit_sha: "abc123…",
  pr_number: 34,
  github_owner: "useverdikt",
  github_repo: "Verdikt",
  callback_url: "https://agent-runner.example.com/hooks/verdikt-verdict"
})
```

### REST

```bash
curl -sS -X POST "$BASE/api/workspaces/$WS/releases" \
  -H "Authorization: Bearer $VERDIKT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "feat/agent-loop (#34)",
    "release_type": "model_update",
    "commit_sha": "abc1234567890abcdef",
    "pr_number": 34,
    "github_owner": "useverdikt",
    "github_repo": "Verdikt",
    "callback_url": "https://agent-runner.example.com/hooks/verdikt-verdict"
  }'
```

Auth: workspace API key or human session with write role.

**Validation:**
- Must be a valid URL (HTTPS required in production)
- Private/localhost/metadata URLs are blocked (SSRF protection)
- Stored on the release row; re-used if `create_release` returns `reused: true` for the same SHA/PR identity

---

## Delivery

Fires **once per verdict** from `postVerdictEffects` after status commits to `CERTIFIED`, `UNCERTIFIED`, or `CERTIFIED_WITH_OVERRIDE`.

- Method: `POST`
- Headers: `Content-Type: application/json`, `User-Agent: Verdikt-Callback/1.0`
- Timeout: 15 seconds
- Redirects: not followed
- Success: HTTP 2xx
- Failure: logged server-side; verdict is **not** rolled back

There is **no HMAC signature** on per-release callbacks. Use HTTPS, a non-guessable path, and network ACLs. For signed workspace-wide delivery, use **Settings → Governance → Outbound webhook**.

---

## Payload

Event type is always `verdikt.verdict`.

```json
{
  "event": "verdikt.verdict",
  "release_id": "rel_…",
  "workspace_id": "ws_…",
  "version": "feat/agent-loop (#34)",
  "status": "CERTIFIED",
  "verdict_issued_at": "2026-06-08T12:00:00.000Z",
  "failed_signals": [],
  "gate": {
    "certified": true,
    "can_merge": true,
    "blocking_signals": [],
    "trajectory": "STABLE",
    "degrading_signals": [],
    "trend_note": null
  },
  "sent_at": "2026-06-08T12:00:01.000Z"
}
```

| Field | Meaning |
|-------|---------|
| `status` | `CERTIFIED`, `UNCERTIFIED`, or `CERTIFIED_WITH_OVERRIDE` |
| `gate.certified` | `true` for certified or override |
| `gate.can_merge` | `true` only for pure `CERTIFIED` (same as strict gate) |
| `gate.blocking_signals` | Signal IDs that failed thresholds |
| `gate.trajectory` | Release trajectory vs recent history |
| `failed_signals` | Full failure objects from verdict intelligence |

**Agent logic:**

```javascript
if (payload.gate.can_merge) {
  // merge / deploy allowed (strict-equivalent)
} else if (payload.status === "COLLECTING") {
  // should not appear on verdict callback — only terminal verdicts
} else if (payload.failed_signals.length) {
  // self_heal or escalate
} else {
  // missing signals or override in strict mode — call check_gate for action
}
```

For the full `action` field (`merge` \| `self_heal` \| `escalate`), call `GET /api/releases/:releaseId/gate` after receiving the callback, or poll gate from GHA for enforcement.

---

## Example receiver

Minimal local receiver for testing (Node 18+):

```bash
node docs/examples/verdikt-verdict-callback-receiver.js
# listens on http://127.0.0.1:9099/verdikt-verdict (dev only — use HTTPS in prod)
```

Point `callback_url` at your tunnel (ngrok, etc.) or a staging HTTPS endpoint.

---

## Recommended agent flow (push + enforce)

```
create_release(..., callback_url)
  → post_signals / wait for integration pull
  → receive verdikt.verdict POST
  → if gate.can_merge → merge PR
  → else self_heal or escalate

Parallel: GHA verdikt-gate job + branch protection blocks merge until gate.exit_code === 0
```

Push notifies the agent; GHA enforces org policy. Both can run together.

See also: `mcp/README.md`, `backend/README.md` (CI/CD gate contract).
