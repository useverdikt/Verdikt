# Verdikt Backend (MVP)

Minimal API for the first end-to-end release certification flow:

1. Register or sign in (JWT)
2. Create release
3. Ingest signals
4. Compute verdict
5. Submit override (if needed)
6. Read immutable audit trail

## Run

Copy **`backend/.env.example`** to **`backend/.env`** and fill in values. **`DATABASE_URL`** (PostgreSQL) is required. **`backend/.env` is gitignored** — do not commit secrets. If a provider API key was ever committed or leaked, **rotate it in the provider console** and scrub history (see **Committed secrets** below).

```bash
npm install
npm start
```

### Automated tests

```bash
npm test
```

With Postgres listening locally and client tools on `PATH`, create the test DB and run the suite in one step:

```bash
npm run test:local-pg
```

(`createdb verdikt_test` + default `DATABASE_URL=postgresql://127.0.0.1:5432/verdikt_test`.)

Runs **`node --test`** against PostgreSQL. Set **`TEST_DATABASE_URL`** or **`DATABASE_URL`**, or create **`verdikt_test`** locally (`createdb verdikt_test`; default URL `postgresql://127.0.0.1:5432/verdikt_test`). Covers `computeVerdict`, delta regression analysis, override scoring, and a few HTTP endpoints (`/health`, auth, thresholds).

Runs on `http://localhost:8787`.

Set strong secrets in production (the server **refuses to start** if they are missing, too short, or still at the dev default):

- **`JWT_SECRET`** — at least **32** characters (e.g. `openssl rand -hex 32`).
- **`WEBHOOK_SECRET`** — at least **24** characters (e.g. `openssl rand -hex 32`).

Applies when **`NODE_ENV=production`** or when you opt in with **`REQUIRE_SECURE_CONFIG=1`** (useful for staging).

```bash
export NODE_ENV=production
export JWT_SECRET="$(openssl rand -hex 32)"
export WEBHOOK_SECRET="$(openssl rand -hex 32)"
npm start
```

Optional AI provider configuration (Gemini default):

```bash
export AI_PROVIDER=gemini
export AI_MODEL=gemini-2.0-flash
export GEMINI_API_KEY="..."
export ENABLE_THRESHOLD_SUGGESTIONS_LLM=1
export ENABLE_ASSISTIVE_LLM=1
```

## Database migrations (PostgreSQL)

Schema changes live in **`migrations/postgres/`** as ordered `NNN_*.sql` files. On startup the API runs pending migrations and records them in **`schema_migrations`**.

- Add new changes as the next number (e.g. `002_add_feature.sql`) — do not rewrite already-applied files in production.

### Waitlist / request-access (`POST /api/waitlist-requests`)

Marketing form submissions are persisted in **`waitlist_requests`** (name, email, company, optional notes, qualification fields `q_role`, `q_team_size`, `q_release_process`, `q_pain_points` JSON, optional `q_goal`, `created_at`, `source_ip`). Rate-limited per IP (see **`WAITLIST_RATE_LIMIT_PER_HOUR`**).

- **Follow-up:** Query the DB (export to CSV, CRM, or a simple admin later). Example:

  ```bash
  psql "$DATABASE_URL" -c "SELECT id, created_at, email, company, name, q_role, q_team_size, q_release_process, q_pain_points FROM waitlist_requests ORDER BY id DESC LIMIT 20;"
  ```

- **Optional inbox ping:** If **`RESEND_API_KEY`**, **`EMAIL_FROM`**, and **`WAITLIST_NOTIFY_EMAIL`** are set, the API sends a notification email to that address for each successful submission (in addition to storing the row).

## Backups

Create a logical dump with **`pg_dump`** (requires **`pg_dump`** on `PATH` and **`DATABASE_URL`**):

```bash
npm run db:backup
```

Writes timestamped **`.sql`** files under **`data/backups/`** (override with `BACKUP_DIR=/path/to/dir`). Schedule this on your host (cron, launchd, or platform snapshots) for production.

### Operations: health, logs, graceful shutdown

- **`GET /health`** — Liveness: returns `{ ok: true }` if the process is running. Use for “is the process up?” probes.
- **`GET /health/ready`** — Readiness: runs `SELECT 1` against PostgreSQL. Returns **503** if the database is unusable. Point orchestrators / load balancers at this for “can this instance take traffic?”
- **Request logging** — After each response, one line is logged: `[request-id] METHOD path status duration`. Disable with **`LOG_REQUESTS=0`**. For JSON lines (Datadog, CloudWatch, etc.) set **`LOG_JSON=1`**.
- **Graceful shutdown** — **`SIGTERM`** / **`SIGINT`** stop the HTTP server, clear the collection sweep interval, and end the PostgreSQL pool. **`SHUTDOWN_GRACE_MS`** (default **10000**) caps how long to wait before `exit(1)` if connections linger.

## CORS, release list pagination, and assistive verdict responses

### `CORS_ORIGINS`

- **Production-like mode** (`NODE_ENV=production` or `REQUIRE_SECURE_CONFIG=1`): **`CORS_ORIGINS` is required**. The server will **refuse to start** if it is missing or empty, so browser clients cannot accidentally use permissive CORS in prod.
- **Development / test** (`NODE_ENV` not `production` and `REQUIRE_SECURE_CONFIG` unset): if **`CORS_ORIGINS` is unset**, the server uses wide-open CORS (`Access-Control-Allow-Origin: *` behavior via `cors()`).
- If set, only listed origins may call the API from a browser. Use a **comma-separated** list, no spaces required (they are trimmed):

```bash
export CORS_ORIGINS="https://app.example.com,https://staging.example.com"
```

Requests **without** an `Origin` header (e.g. curl, server-to-server) are still allowed when using this allowlist.

### Security headers & reverse proxies

- Responses include **[Helmet](https://helmetjs.github.io/)** defaults tuned for a JSON API (`Content-Security-Policy` is disabled; `Cross-Origin-Resource-Policy` is `cross-origin` for split SPA/API hosting).
- Behind nginx or a load balancer, set **`TRUST_PROXY=1`** so Express treats `req.ip` correctly (used for rate limiting and audit metadata).

### Session verification (SPA)

The frontend treats **`GET /api/auth/me`** as the source of truth after login: protected routes verify the JWT on load so **expired or revoked tokens** are cleared without waiting for another API call.

### `GET /api/workspaces/:workspaceId/releases` pagination

The list endpoint returns **`total_count`**, **`limit`**, **`has_more`**, and optional **`next_before`** for cursor paging.

- **`limit`** — optional query param (default **50**, max **200**).
- **`before`** — optional ISO timestamp: return releases with `created_at` **strictly before** this value (same sort: newest first). Use the **`next_before`** value from the previous response as the next page’s `before`.

Example:

```bash
curl -sS "$BASE/api/workspaces/ws_demo/releases?limit=50" -H "Authorization: Bearer $TOKEN"
curl -sS "$BASE/api/workspaces/ws_demo/releases?limit=50&before=2026-04-01T12:00:00.000Z" -H "Authorization: Bearer $TOKEN"
```

The **`releases`** array shape is unchanged; clients that only read **`releases`** keep working.

### `assistive_enrichment_pending`

When **`ENABLE_ASSISTIVE_LLM=1`** and a provider API key is configured, signal-ingest responses that compute a verdict may include:

- **`assistive_enrichment_pending`: `true`** — the HTTP response already contains the **deterministic** verdict intelligence; an optional LLM pass may **update** `release_intelligence` shortly afterward (same release id). Clients can **re-fetch** `GET /api/releases/:releaseId` or intelligence after a few seconds if they want the enriched wording.

If assistive LLM is off or no key is set, the field is **`false`** and no background enrichment is queued.

## Authentication

- `GET /api/public/registration` — returns `{ "allow_public_registration": boolean }`. The SPA uses this so `/onboarding` can show either the full wizard (last step calls register) or a **design-partner** message when registration is closed.

- `POST /api/auth/register` — body: `{ "email", "password", "name?" }` — password min 8 characters. Returns `{ token, user }` with `user.workspace_id` for your tenant. Rate-limited per client IP (default **15 new accounts per rolling hour**, override with **`REGISTER_RATE_LIMIT_PER_HOUR`**). Returns **403** when public registration is disabled — see **`ALLOW_PUBLIC_REGISTRATION`** below.

- `POST /api/auth/login` — body: `{ "email", "password" }` — returns `{ token, user }`.
- `POST /api/auth/forgot-password` — body: `{ "email" }` — generic success message whether or not the user exists (no enumeration). If the user exists, a reset token is stored (hashed) and **an email is sent** when **`RESEND_API_KEY`** and **`PUBLIC_APP_URL`** (or **`FRONTEND_URL`**) are set — see **Password reset email** below. On startup in production-like mode, the server **warns** if email is not configured. For local testing or automated tests, set **`PASSWORD_RESET_RETURN_TOKEN=1`** or use **`NODE_ENV=test`** so the response may include **`reset_token`** and **`reset_expires_at`** (never enable token return in production).
- `POST /api/auth/reset-password` — body: `{ "token", "password" }` — one-time use, expires after 60 minutes.
- `GET /api/auth/me` — header: `Authorization: Bearer <token>`.
- `POST /api/hooks/release-promoted` — signed webhook trigger for release session creation.

### `ALLOW_PUBLIC_REGISTRATION` (design-partner / invite-only)

- In **production-like mode** (`NODE_ENV=production` or **`REQUIRE_SECURE_CONFIG=1`**), public self-service signup is **off by default** (`POST /api/auth/register` returns **403**).
- To **allow** open registration (e.g. local prod testing), set **`ALLOW_PUBLIC_REGISTRATION=1`**.
- To **force closed** even in development, set **`ALLOW_PUBLIC_REGISTRATION=0`**.

**Provision a user when signup is closed** (from `backend/`):

```bash
npm run provision:user -- partner@company.com 'YourSecurePass123' 'Partner Name'
# or: PROVISION_EMAIL=... PROVISION_PASSWORD=... PROVISION_NAME='...' npm run provision:user
```

Then share **`/login`** — they use the password you set; optional password reset email still applies if configured.

### Password reset email (Resend)

Configure [Resend](https://resend.com) (HTTPS API, no extra npm dependency):

```bash
export RESEND_API_KEY="re_..."
export PUBLIC_APP_URL="https://your-spa-origin.example.com"   # no trailing slash; reset links go to /reset-password?token=...
# Optional — defaults to `onboarding@resend.dev` sender for quick tests
# export EMAIL_FROM="Verdikt <noreply@yourdomain.com>"
```

The reset link uses **`PUBLIC_APP_URL`** so it must match where users open the React app (same host you set in the frontend’s **`VITE_API_BASE`** for API calls).

### Committed secrets (`.env` in git history)

If **`backend/.env`** or any file with live keys was ever committed:

1. **Rotate** every exposed secret (Gemini/Google AI, JWT signing, webhooks, Resend, etc.) in the provider dashboards.
2. Remove the file from **all** branches’ history, e.g. with [git-filter-repo](https://github.com/newren/git-filter-repo):

```bash
git filter-repo --path backend/.env --invert-paths
```

Then force-push protected branches only if your team policy allows, and treat any old clone as compromised for secrets.

**Seeded demo account** (on server startup when **not** `NODE_ENV=production`, or when **`ENABLE_DEMO_SEED=1`**; skipped in production by default):

- Email: `demo@verdikt.local`
- Password: `demo123`
- Workspace: `ws_demo`
- Role: `vp_engineering` (so **`POST /api/releases/:id/override`** works in local/demo without a second approver user)

**Supabase Auth (when the SPA has `VITE_SUPABASE_URL` + anon key):** the login page uses **`supabase.auth.signInWithPassword`**, not `POST /api/auth/login`. Seed only inserts **`public.users`** with a bcrypt hash. You must also (1) **create the same email** in **Supabase → Authentication → Users** (same password), and (2) link it: run **`UPDATE users SET auth_user_id = '<uuid from auth.users>' WHERE email = 'demo@verdikt.local';`** (get the UUID from **Authentication** or `select id, email from auth.users`). Session exchange matches JWT `sub` via `findApplicationUserForSupabaseSub` (`auth_user_id` or `id`). If **`screenshots@verdikt.local`** works but **demo** does not, **demo** is usually missing from **auth.users** or **`auth_user_id`** is null.

**Automated fix:** set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Dashboard → Settings → API → service_role), and `DATABASE_URL` in `backend/.env`, then run:

```bash
cd backend && npm run seed:demos && npm run seed:demos:supabase
```

`seed:demos` ensures `public.users` rows; `seed:demos:supabase` creates Auth users and sets `auth_user_id`.

All workspace and release endpoints require `Authorization: Bearer <token>` and only allow access to the workspace encoded in the token.

## MVP product surface (what is wired vs illustrative)

- **Implemented in this API:** registration/login, per-workspace thresholds, releases, signal ingest and verdicts, signed **release-promoted webhooks**, overrides, workspace audit events, password reset (**email via Resend** when `RESEND_API_KEY` + `PUBLIC_APP_URL` are set), health/readiness, optional LLM features when provider keys are set.
- **SPA “vendor” rows** (e.g. BrowserStack, Sentry, Braintrust) in the certification UI are **demo lanes** for grouping signals and manual simulation. They are **not** live vendor SDK integrations in this repository — use **webhooks** and **authenticated ingest** (`POST /api/releases/:releaseId/signals`, integration routes) for real data.
- **Public `/badge` page** (frontend) shows **static demo records** for layout and embed snippets. There is **no public unauthenticated API** here to render an arbitrary customer release on that URL; the **authoritative record** is behind login (dashboard + audit log).
- **Threshold suggestions** in Settings call the backend when suggestions are enabled; empty or disabled behaviour depends on env (see threshold suggestion env vars above).

## Endpoints (protected unless noted)

- `GET /health` (public)
- `POST /api/hooks/release-promoted` (public but requires `x-verdikt-signature`)
- `POST /api/workspaces/:workspaceId/integrations/evals` (public, signed integration ingest)
- `POST /api/auth/register` (public)
- `POST /api/auth/login` (public)
- `GET /api/auth/me`
- `GET /api/workspaces/:workspaceId/thresholds`
- `POST /api/workspaces/:workspaceId/thresholds`
- `GET /api/workspaces/:workspaceId/policies`
- `POST /api/workspaces/:workspaceId/policies`
- `GET /api/workspaces/:workspaceId/threshold-suggestions`
- `POST /api/workspaces/:workspaceId/threshold-suggestions/:suggestionId/apply`
- `POST /api/workspaces/:workspaceId/threshold-suggestions/:suggestionId/dismiss`
- `GET /api/signal-definitions`
- `GET /api/workspaces/:workspaceId/releases`
- `POST /api/workspaces/:workspaceId/releases`
- `POST /api/releases/:releaseId/signals`
- `POST /api/releases/:releaseId/signals/integrations` (provider payload adapter)
- `POST /api/releases/:releaseId/override`
- `GET /api/releases/:releaseId`
- `GET /api/releases/:releaseId/gate` (CI/CD release gate decision)
- `GET /api/workspaces/:workspaceId/audit`

## Quick flow example

```bash
BASE=http://localhost:8787
TOKEN=$(curl -sS -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@verdikt.local","password":"demo123"}' | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).token))")
AUTH=( -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" )

# 1) Create release
REL=$(curl -sS -X POST "$BASE/api/workspaces/ws_demo/releases" "${AUTH[@]}" \
  -d '{"version":"model-v1.0.0","release_type":"model_update","environment":"pre-prod","ai_context":{"model_version":"model-v1.0.0","prompt_bundle":"support-prompts-2026-04"}}')
REL_ID=$(echo "$REL" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).id))")

# 2) Ingest eval signals
curl -sS -X POST "$BASE/api/releases/$REL_ID/signals" "${AUTH[@]}" \
  -d '{"source":"braintrust","signals":{"accuracy":79,"safety":92,"relevance":74,"p95latency":210}}'

# 3) Override when uncertified
curl -sS -X POST "$BASE/api/releases/$REL_ID/override" "${AUTH[@]}" \
  -d '{"approver_type":"PERSON","approver_name":"Alex Baird","approver_role":"VP Engineering","justification":"Hotfix queued within 48h","metadata":{"deploy_id":"dep_123"}}'

# 4) Read release with audit
curl -sS "$BASE/api/releases/$REL_ID" -H "Authorization: Bearer $TOKEN"
```

## Trigger webhook example (minimal, signed)

```bash
BASE=http://localhost:8787
WEBHOOK_SECRET=dev-webhook-secret
BODY='{"workspace_id":"ws_demo","release_ref":"rc/model-v2.4.1","release_type":"model_update","environment":"uat","source":"github_tag","mappings":{"eval_run_id":"eval/run-4412-v2.4.1","prompt_bundle_id":"support-prompts-2026-04"},"collection_window_minutes":120}'
SIG=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')

curl -sS -X POST "$BASE/api/hooks/release-promoted" \
  -H "Content-Type: application/json" \
  -H "x-verdikt-signature: sha256=$SIG" \
  -H "x-idempotency-key: ws_demo:rc/model-v2.4.1:github_tag" \
  -d "$BODY"
```

## GitHub Action trigger example

```yaml
name: Trigger Verdikt On RC Tag
on:
  push:
    tags:
      - "rc/*"

jobs:
  trigger-verdikt:
    runs-on: ubuntu-latest
    steps:
      - name: Build webhook payload
        id: payload
        run: |
          BODY=$(cat <<'EOF'
          {
            "workspace_id": "${{ secrets.VERDIKT_WORKSPACE_ID }}",
            "release_ref": "${{ github.ref_name }}",
            "release_type": "model_update",
            "environment": "uat",
            "source": "github_tag",
            "mappings": {
              "sentry_release": "${{ github.ref_name }}"
            },
            "collection_window_minutes": 120
          }
          EOF
          )
          echo "body=$BODY" >> "$GITHUB_OUTPUT"
      - name: Sign and send
        env:
          BODY: ${{ steps.payload.outputs.body }}
          SECRET: ${{ secrets.VERDIKT_WEBHOOK_SECRET }}
          URL: ${{ secrets.VERDIKT_WEBHOOK_URL }}
        run: |
          SIG=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
          curl -sS -X POST "$URL" \
            -H "Content-Type: application/json" \
            -H "x-verdikt-signature: sha256=$SIG" \
            -H "x-idempotency-key: ${{ github.run_id }}:${{ github.ref_name }}" \
            -d "$BODY"
```

## Webhook payload contract

Required:
- `workspace_id` (string)
- `release_ref` (string; example: `rc/model-v2.4.1`)

Optional:
- `release_type` (string, default `model_update`) — allowed values:
  - `prompt_update`
  - `model_patch`
  - `safety_patch`
  - `policy_change`
  - `model_update`
- `environment` (string, default `pre-prod`)
- `source` (string, default `webhook`)
- `mappings` (object, default `{}`)
- `collection_window_minutes` (number, clamped between 5 and 1440)
- `idempotency_key` (string; alternatively send `x-idempotency-key` header)

## Signal ingest contract

`POST /api/releases/:releaseId/signals`

- `source` (string, optional)
- `signals` (object of `{ [signal_id]: number }`)

Non-numeric values are ignored.

Integration adapter endpoint:

`POST /api/releases/:releaseId/signals/integrations`

- Body:
  - `provider` (string; e.g. `braintrust`, `langsmith`, `helicone`, `openai_evals`)
  - `payload` (object; raw provider payload or a simple `{ metrics: { ... } }`)
  - `source` (optional string override)
- Supported mapped signal IDs:
  - `accuracy`, `safety`, `tone`, `hallucination`, `relevance`, `p95latency`, `p99latency`
- Common aliases auto-mapped:
  - `exact_match` → `accuracy`
  - `correctness` → `accuracy`
  - `harmlessness` → `safety`
  - `answer_relevance` → `relevance`
  - `p95_latency` / `latency_p95` → `p95latency`
  - `p99_latency` / `latency_p99` → `p99latency`

Example:

```bash
curl -sS -X POST "$BASE/api/releases/$REL_ID/signals/integrations" "${AUTH[@]}" \
  -d '{"provider":"braintrust","payload":{"metrics":{"exact_match":79,"safety":92,"answer_relevance":74,"p95_latency":210}}}'
```

Provider payload templates:

```bash
# Braintrust-style
curl -sS -X POST "$BASE/api/releases/$REL_ID/signals/integrations" "${AUTH[@]}" \
  -d '{"provider":"braintrust","payload":{"metrics":{"exact_match":82,"harmlessness":94,"answer_relevance":79,"p95_latency":225}}}'

# LangSmith-style
curl -sS -X POST "$BASE/api/releases/$REL_ID/signals/integrations" "${AUTH[@]}" \
  -d '{"provider":"langsmith","payload":{"scores":{"correctness":84,"safety":93,"relevance":81,"latency_p99":480}}}'

# OpenAI evals-style
curl -sS -X POST "$BASE/api/releases/$REL_ID/signals/integrations" "${AUTH[@]}" \
  -d '{"provider":"openai_evals","payload":{"results":{"accuracy":86,"safety":95,"tone":90,"groundedness":92}}}'

# Helicone-style
curl -sS -X POST "$BASE/api/releases/$REL_ID/signals/integrations" "${AUTH[@]}" \
  -d '{"provider":"helicone","payload":{"metrics":{"p95_latency":210,"p99_latency":520,"error_rate":0.9,"answer_relevance":80}}}'
```

Synthetic eval fixtures (healthy, borderline, failing, generic) for demos and local testing:

- `backend/fixtures/fake-eval-payloads.json`
- `backend/fixtures/fake-eval-payloads-rich.json` (v2 richer scenarios, threshold profiles, override fixtures, e2e sequences)

Workspace integration webhook (signed):

`POST /api/workspaces/:workspaceId/integrations/evals`

- Signature required via `x-verdikt-signature: sha256=<hmac>`
- Uses `WEBHOOK_SECRET` and same verification model as trigger webhooks
- Payload lookup fields (any one):
  - `release_id`
  - `release_ref`
  - `version`
- Also accepts `provider`, `payload`, `source` as in the authenticated integration adapter.

Example:

```bash
BODY='{"provider":"langsmith","release_id":"rel_123","payload":{"metrics":{"correctness":81,"harmlessness":93,"answer_relevance":77}}}'
SIG=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
curl -sS -X POST "$BASE/api/workspaces/ws_demo/integrations/evals" \
  -H "Content-Type: application/json" \
  -H "x-verdikt-signature: sha256=$SIG" \
  -d "$BODY"
```

Provider webhook template (release_ref lookup):

```bash
BODY='{"provider":"braintrust","release_ref":"rc/model-v2.4.1","payload":{"metrics":{"exact_match":83,"harmlessness":95,"answer_relevance":81,"p95_latency":208}}}'
SIG=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
curl -sS -X POST "$BASE/api/workspaces/ws_demo/integrations/evals" \
  -H "Content-Type: application/json" \
  -H "x-verdikt-signature: sha256=$SIG" \
  -d "$BODY"
```

## CI/CD release gate contract

`GET /api/releases/:releaseId/gate`

- Query param: `mode` (optional)
  - `default` (or omitted): allows `CERTIFIED` and `CERTIFIED_WITH_OVERRIDE`
  - `strict`: allows `CERTIFIED` only

Response:

- `gate.allowed` (boolean)
- `gate.reason` (string)
- `gate.exit_code` (`0` or `1`) for direct pipeline use

Example:

```bash
GATE=$(curl -sS "$BASE/api/releases/$REL_ID/gate?mode=strict" -H "Authorization: Bearer $TOKEN")
echo "$GATE" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.gate.reason);process.exit(j.gate.exit_code);})"
```

## AI signal definitions and context

- `GET /api/signal-definitions` returns canonical AI signal meanings (`accuracy`, `safety`, `tone`, `hallucination`, `relevance`).
- `GET /api/workspaces/:workspaceId/policies` returns AI evidence policy.
- `POST /api/workspaces/:workspaceId/policies` updates:
  - `require_ai_eval` (boolean)
  - `ai_missing_policy` (`block_uncertified` | `allow_without_ai`)
- Release creation (`POST /api/workspaces/:workspaceId/releases`) and trigger webhook accept optional `ai_context` object (for metadata such as model version, prompt bundle, eval run id, dataset version, evaluator version).
- `GET /api/releases/:releaseId` includes parsed `release.ai_context`.

## AI threshold suggestions

- `GET /api/workspaces/:workspaceId/threshold-suggestions` returns computed suggestions from recent release/signal history.
- `POST /api/workspaces/:workspaceId/threshold-suggestions/:suggestionId/apply` applies the suggested min/max to thresholds.
- `POST /api/workspaces/:workspaceId/threshold-suggestions/:suggestionId/dismiss` records dismissal in audit trail.
- If `ENABLE_THRESHOLD_SUGGESTIONS=0`, these endpoints return `404` (`threshold suggestions disabled`).
- Suggestion reasons are rule-based by default; optional LLM explanation enrichment can be enabled with `ENABLE_THRESHOLD_SUGGESTIONS_LLM=1`.
- Provider selection:
  - Gemini (default): set `AI_PROVIDER=gemini` and `GEMINI_API_KEY`
  - Anthropic: set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`

## Assistive intelligence (deterministic)

Verdikt keeps deterministic certification enforcement and adds an assistive intelligence artifact per release.

- Optional LLM enrichment for verdict brief can be enabled with `ENABLE_ASSISTIVE_LLM=1` (deterministic fallback always remains active).

- `GET /api/releases/:releaseId/intelligence`
  - Returns persisted intelligence object:
    - `verdict` (risk summary, likely failure modes, recommended actions, confidence)
    - `override` (override justification assessment quality/score/flags)
    - `trace` (`model`, `prompt_version`, `input_context_hash`)
    - `decision` (latest user decision marker)
    - `outcome` (latest post-release outcome marker)
- `POST /api/releases/:releaseId/intelligence/decision`
  - Body:
    - `decision` (required): `applied` | `dismissed` | `overridden` | `shipped`
    - `notes` (optional string)
    - `actor` (optional string)
- `POST /api/releases/:releaseId/intelligence/outcome`
  - Body:
    - `label` (required): `incident` | `no_incident` | `followup_met`
    - `notes` (optional string)
    - `observed_at` (optional ISO timestamp string)

Example:

```bash
# Read intelligence
curl -sS "$BASE/api/releases/$REL_ID/intelligence" -H "Authorization: Bearer $TOKEN"

# Record decision
curl -sS -X POST "$BASE/api/releases/$REL_ID/intelligence/decision" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"decision":"applied","notes":"Applied recommendation in release review."}'

# Record outcome
curl -sS -X POST "$BASE/api/releases/$REL_ID/intelligence/outcome" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"label":"no_incident","notes":"No incident within 7 days."}'
```

## Collection window behavior

- Release starts in `COLLECTING`.
- If required thresholded signals are still missing and deadline has not passed, status remains `COLLECTING`.
- Verdict is issued when all required signals arrive, or when deadline expires.
- Missing required signals at evaluation are explicitly included in `failed_signals`.
- AI signals are required by default (`workspace_policies.require_ai_eval=1`, `ai_missing_policy=block_uncertified`), so missing AI eval evidence blocks certification when verdict is issued.

## Structured override metadata

Override requests must include structured metadata:

- `metadata.impact_summary` (string, min length 8)
- `metadata.mitigation_plan` (string, min length 8)
- `metadata.follow_up_due_date` (`YYYY-MM-DD`)

## Retries and idempotency

- Safe retries are supported for trigger webhook via idempotency key.
- Reusing the same idempotency key returns the original release (`reused: true`).
- Recommended key format: `<pipeline-run-id>:<release-ref>`.

## Operational notes

- Request IDs are returned as `x-request-id` in responses.
- Webhook endpoint is rate-limited in-memory (`WEBHOOK_RATE_LIMIT_PER_MINUTE`, default `120`).
- Keep `JWT_SECRET` and `WEBHOOK_SECRET` rotated and managed via secrets store.
- Define your retention policy before production (recommended: keep release/audit records for at least 12 months for governance evidence).

## E2E script (API)

The demo user **`demo@verdikt.local` / `demo123`** is created on server startup when demo seeding is enabled (`seedDemoUser`; see **`ENABLE_DEMO_SEED`** in `.env.example`). In local (non–production-like) mode the server defaults **`WEBHOOK_SECRET` to `dev-webhook-secret`**, matching the HMAC used in `scripts/test-e2e.sh` when `WEBHOOK_SECRET` is unset.

**One command** (starts the API, waits for `/health`, runs the curl script, then stops the server):

```bash
npm run test:e2e:live
```

**Manual** (two terminals):

```bash
npm start
# other terminal:
npm run test:e2e
```

### Browser E2E (full stack)

From **`frontend/`**, Playwright starts the backend and Vite (via `concurrently`), then runs UI tests. Tests log in as the seeded demo user by calling **`POST /api/auth/login`** and storing the JWT in `localStorage` before loading the SPA (so startup API calls do not 401 and bounce to **`/login`**).

```bash
cd ../frontend
npm install
# If Playwright reports a missing browser binary (e.g. wrong arch), reinstall:
unset PLAYWRIGHT_BROWSERS_PATH
npx playwright install chromium
npm run test:e2e
```

## Synthetic data seed

Generate synthetic multi-startup data to exercise trends, suggestions, overrides, and integration pathways.

This script simulates 10 AI startup teams by default, with mixed flows across:

- Product surfaces: AI web app, AI mobile app, API/backend
- Trigger modes: pipeline webhook, GitHub label, Jira transition, env promotion, manual declaration
- Signal ingest paths: integration adapter, signed workspace webhook, manual entry, CSV-like imports
- Providers: Braintrust, LangSmith, Datadog, Sentry

```bash
# Default: 10 startups x 5 releases each
npm run seed:synth

# Custom scale/profile
BASE_URL=http://localhost:8792 WEBHOOK_SECRET=dev-webhook-secret STARTUPS=3 RELEASES_PER_STARTUP=4 PROFILE=risky npm run seed:synth
```

Supported env vars:

- `BASE_URL` (default `http://localhost:8787`)
- `STARTUPS` (default `10`)
- `RELEASES_PER_STARTUP` (default `5`)
- `PROFILE` (`mixed` | `healthy` | `risky`)
- `WEBHOOK_SECRET` (must match server env for signed webhook flows)
- `PASSWORD` (default `demo12345`, used for generated startup users)

## Full lifecycle synthetic seed (dashboard-realistic)

Generates releases that mimic the full flow:

1. signed release trigger webhook
2. signed workspace eval ingest webhook (provider payload mapping)
3. delivery/runtime signal ingest
4. optional override on uncertified releases

```bash
# Default: 10 full-lifecycle releases
BASE_URL=http://localhost:8792 WEBHOOK_SECRET=dev-webhook-secret npm run seed:e2e

# More data / different profile
BASE_URL=http://localhost:8792 WEBHOOK_SECRET=dev-webhook-secret COUNT=20 PROFILE=risky npm run seed:e2e
```

Supported env vars:

- `BASE_URL` (default `http://localhost:8787`)
- `WORKSPACE_ID` (default `ws_demo`)
- `COUNT` (default `10`)
- `PROFILE` (`mixed` | `healthy` | `risky`)
- `WEBHOOK_SECRET` (must match server env)
- `EMAIL` / `PASSWORD` (default demo account)

## Deterministic demo workspace matrix (`ws_demo`)

Use this when you need **one pass** through the release dashboard and intelligence hub: **COLLECTING**, **CERTIFIED**, **UNCERTIFIED** (absolute threshold, latency SLO, regression vs a prior certified release), **CERTIFIED_WITH_OVERRIDE**, manual “UI-style” create + integration ingest, **production-signals** (with optional alignment and incident ref), and intelligence **decision** / **outcome** rows.

Requires the same **`WEBHOOK_SECRET`** as the running server (local default **`dev-webhook-secret`** matches unsigned dev defaults). After migrations and **`npm run seed:demos`**, with the API running:

```bash
cd backend
WEBHOOK_SECRET=dev-webhook-secret npm run seed:demo:full
```

- **`DEMO_SEED_TAG`** — optional string; webhooks are idempotent per key, so **change this** (or use a fresh DB) when re-seeding the same workspace.
- **`BASE_URL`**, **`WORKSPACE_ID`**, **`EMAIL`**, **`PASSWORD`** — same as **`seed:e2e`**.

With **Supabase Auth** in the SPA, still run **`npm run seed:demos:supabase`** so **`auth_user_id`** matches; this script uses **`POST /api/auth/login`** (Express/JWT), which must validate against **`public.users`** (bcrypt). If only Supabase has the password, sync or use a token from your environment.
