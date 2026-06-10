# Optional: CI webhook for custom GHA metrics

**Not the default Verdikt flow.** Most workspaces should use:

1. **`verdikt:rc` label** on the PR → Verdikt opens the cert window (`commit_sha` + `pr_number`).
2. **Verdikt pulls signals** from connected integrations (Braintrust, BrowserStack, Sentry, Datadog, etc.) or the agent calls **`post_signals`** via MCP.
3. Agent calls **`check_gate`** → `action`: `merge` | `self_heal` | `escalate`.

You do **not** need GitHub Actions to POST signals for this model.

---

## When the CI webhook is useful

Use `POST /api/workspaces/:workspaceId/integrations/ci` only if:

- You compute metrics **inside GHA** that are not available in Braintrust/BrowserStack/etc.
- You want a pipeline to push a small custom signal bundle after a job completes.

Requires the release-identity API (`/integrations/ci`) to be deployed on your Verdikt backend.

---

## Example curl (not a runnable workflow)

Do **not** place this in `.github/workflows/` unless you explicitly want it — any `.yml` there runs on every PR.

```bash
BODY=$(jq -n \
  --arg sha "$COMMIT_SHA" \
  --argjson pr "$PR_NUMBER" \
  --arg owner "$REPO_OWNER" \
  --arg repo "$REPO_NAME" \
  '{commit_sha:$sha,pr_number:$pr,repo_owner:$owner,repo_name:$repo,signals:{custom_metric:99}}')
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')"
curl -sS -X POST "$VERDIKT_API/api/workspaces/$WS/integrations/ci" \
  -H "Content-Type: application/json" \
  -H "x-verdikt-signature: $SIG" \
  -d "$BODY"
```

Apply **`verdikt:rc` first** (or `create_release` with the same SHA) so the webhook attaches to the correct cert window.

See `backend/README.md` for the full contract.
