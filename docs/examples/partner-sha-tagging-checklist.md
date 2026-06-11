# Partner SHA tagging checklist

Verdikt auto-pulls signals when you apply **`verdikt:rc`** on a PR. Pulls match data to the **PR head commit SHA**. If your tools don't tag runs with that SHA, the cert window stays **COLLECTING**.

Use **Settings → Signal sources → Check SHA readiness** (or `GET /api/workspaces/:id/integration-readiness`) before go-live.

---

## Before first cert

1. GitHub App + label trigger configured (`verdikt:rc`).
2. Each integration **Connected** in Verdikt Settings.
3. Partner CI tags eval/build/deploy with the **same SHA** as the PR head.
4. Run **Probe SHA** with a real commit from a test PR.

---

## Per vendor

### Braintrust

- **Supports SHA:** Yes — git metadata on experiments (`commit`, `git_sha` in metadata).
- **Partner must:** Run evals from CI on the PR commit; pass `git_metadata` or enable org git capture.
- **Verdikt matches:** Experiment name/metadata containing the commit SHA.

### BrowserStack

- **Supports SHA:** Yes — auto-detect with SDK; or set `build_tag` = full commit SHA.
- **Partner must:** Pass commit as build tag when triggering Automate builds if not using SDK.
- **Verdikt matches:** Build name or `build_tag` against PR SHA.

### Sentry

- **Supports SHA:** Yes — release version = commit SHA; `sentry-cli releases set-commits --auto`.
- **Partner must:** Create Sentry release named with git SHA in CI before deploy.
- **Verdikt matches:** Release lookup by SHA (full or short).

### Datadog

- **Supports SHA:** Yes — `DD_GIT_COMMIT_SHA`, `git.commit.sha` metric tag, `{{commit_sha}}` in queries.
- **Partner must:** Set git env vars at deploy; configure Datadog query template in Verdikt settings.
- **Verdikt matches:** Metrics scoped to `git.commit.sha`.

### LangSmith

- **Supports SHA:** Yes — run metadata / commit hash fields.
- **Partner must:** Tag runs with commit metadata in CI.
- **Verdikt matches:** Run name or metadata vs PR SHA.

---

## API

```bash
# Checklist (no vendor HTTP calls)
curl -sS "$BASE/api/workspaces/$WS/integration-readiness" \
  -H "Authorization: Bearer $TOKEN"

# Probe SHA match (Braintrust + BrowserStack live; others via cert pull)
curl -sS -X POST "$BASE/api/workspaces/$WS/integration-readiness/probe" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"commit_sha":"abc1234567890deadbeef"}'
```

---

## If probe fails

1. Confirm the eval/build actually ran on that commit in the vendor UI.
2. Fix tagging in partner CI — do not invent signals in the agent.
3. Use **Signal Simulator** or `post_signals` only for metrics with no integration source.
