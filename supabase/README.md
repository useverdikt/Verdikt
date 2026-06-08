# Supabase (Postgres + migrations + RLS)

This folder targets **Supabase** (hosted Postgres + Auth + RLS) alongside the Vite SPA. The **Express backend** connects to the same Postgres via `DATABASE_URL`.

## Two migration tracks (read this first)

Verdikt uses **two folders** that can change the database. They serve different jobs:

| Track | Folder | Applied by | When |
|-------|--------|------------|------|
| **App schema** | `backend/migrations/postgres/` | Express backend on startup | Every time the backend starts (`runMigrations` in `backend/src/database/runMigrations.js`) |
| **Supabase extras** | `supabase/migrations/` | Supabase CLI or SQL Editor | `supabase db push`, `supabase db reset`, or manual paste in the dashboard |

**Production (typical):** `DATABASE_URL` points at Supabase Postgres. You deploy the backend; on startup it applies `backend/migrations/postgres/` (including recent changes like `required_for_certification` and `recommendation_json`). You do **not** need `supabase db push` for those columns if the backend has started successfully against that database.

**Local Supabase stack:** `supabase db reset` applies only `supabase/migrations/`. Start the backend at least once (or run CI/tests) so `backend/migrations/postgres/` runs against the same database.

**Rule of thumb:** If the app API works and backend logs show `[migrations] applied: …`, the app schema is current. Use the Supabase track for Auth linkage, RLS policies, and triggers that depend on `auth.users`.

### Verify columns exist (Supabase SQL Editor)

```sql
-- Required-for-cert toggles (Thresholds UI)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'thresholds' AND column_name = 'required_for_certification';

-- Split recommendation vs user decision JSON
SELECT column_name FROM information_schema.columns
WHERE table_name = 'release_intelligence' AND column_name = 'recommendation_json';
```

Each query should return one row. If not, restart the backend against that database or run the matching file from `backend/migrations/postgres/` once in the SQL Editor.

---

## Supabase migrations (`supabase db push`)

Run in filename order:

| File | Purpose |
|------|---------|
| `20260415000000_verdikt_initial.sql` | Full baseline schema (Postgres types). |
| `20260415000001_auth_linkage.sql` | `users.auth_user_id` → `auth.users(id)`. |
| `20260415000002_rls.sql` | RLS + helper functions + grants. |
| `20260415000003_auth_user_trigger.sql` | Nullable `password_hash`; trigger on `auth.users` → `public.users` + workspace/threshold seed. |
| `20260607000004_workspace_github_rls.sql` | Enable RLS on GitHub/webhook integration tables in `public`. |

**Cloud:**

```bash
supabase link --project-ref <ref>
supabase db push
```

**Local:** `supabase start` then `supabase db reset` (applies the files above + `seed.sql`).

One-shot from repo root (**Docker Desktop running**):

```bash
bash scripts/supabase-local-bootstrap.sh
```

Or from `frontend/`: `npm run supabase:local` — starts the stack, runs `db reset`, writes `frontend/.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and attempts a test signup (`localdev@verdikt.local` / `localdev123456`; override with `SUPABASE_TEST_EMAIL` / `SUPABASE_TEST_PASSWORD`). Open Studio at `http://127.0.0.1:54323` and confirm `public.users` and workspace seed rows.

To refresh env only after the stack is already up:

```bash
node scripts/write-supabase-local-env.mjs
```

---

## Backend migrations (applied on API startup)

These live in `backend/migrations/postgres/` and run automatically when the Express server starts. Tracked in `schema_migrations`.

| File | Purpose |
|------|---------|
| `001_baseline.sql` | Full app schema (squashed baseline). |
| `002_workspace_inbound_webhook_secrets.sql` | Per-workspace inbound webhook HMAC secrets. |
| `003_github_label_triggers.sql` | GitHub label-trigger config per workspace. |
| `004_github_app_installations.sql` | GitHub App install + repo connection tables. |
| `005_enable_rls_on_workspace_github_tables.sql` | RLS on integration tables (mirrors `20260607000004` for non–Supabase CLI paths). |
| `006_threshold_required_for_cert.sql` | `thresholds.required_for_certification` column + defaults. |
| `007_recommendation_json.sql` | `release_intelligence.recommendation_json`; migrates legacy recommendation blobs out of `decision_json`. |

Add new **app** schema changes here as the next numbered file. The backend applies each file at most once.

---

## App integration (this repo)

- **Frontend:** If `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, **Login** uses `signInWithPassword`, then **`POST /api/auth/session-from-supabase`** exchanges the Supabase `access_token` for the same **HttpOnly Express session cookies** as email/password login (so `/api/*` works). Otherwise the Express `/api/auth/login` path is used.
- **Protected routes:** With Supabase configured, the SPA verifies the Supabase session, then **session exchange** ensures the backend cookie is set. **GET /api/auth/me** loads the user row from **PostgreSQL** via `DATABASE_URL`.
- **New Supabase signups:** The trigger creates `public.users` and default workspace rows. Email confirmation settings in the Supabase dashboard still apply before `auth.users` gets an insert.

### Backend env (session exchange)

- **`SUPABASE_JWT_SECRET`** — Supabase Dashboard → **Settings → API → JWT Secret** (not the anon key). Required for `POST /api/auth/session-from-supabase`.
- **`DATABASE_URL`** — **Required** for the Express API. Use the **pooler** connection string for server apps when connecting to Supabase Postgres.

## Hosted Auth URLs (dashboard)

For a **cloud** project: **Authentication → URL configuration** — add **Site URL** and **Redirect URLs** for your app (e.g. `http://localhost:5173`, `https://useverdikt.com`, and preview URLs). This is not stored in `config.toml` for hosted Supabase.

## Environment

- **Frontend:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (only the anon key in the browser).
- **Backend:** `SUPABASE_JWT_SECRET` (session exchange). **`DATABASE_URL`** for Postgres (pooler URI recommended for Supabase). Never put the service role key in Vite.

## Auth

The **`on_auth_user_created`** trigger sets **`public.users.auth_user_id`** and seeds the workspace. For RLS, policies use `auth.uid()`; keep **`auth_user_id`** in sync with Auth. Legacy Express-only users may need a one-time backfill.

Demo accounts: `npm run seed:demos` (backend) and `npm run seed:demos:supabase` — see [backend/README.md](../backend/README.md).

## Express + Supabase (data layer)

The **REST API** reads and writes **PostgreSQL** only (`backend/src/database`, `pg` pool, `DATABASE_URL`).

**Supabase migrations** add **RLS**, **`auth.users` linkage**, and dashboard-oriented policies. **Backend migrations** own ongoing app tables and columns. Both can target the same Supabase Postgres instance; avoid duplicating the same DDL in both folders unless intentional (e.g. RLS enablement mirrored in `005` and `20260607000004`).

**Tests:** `npm run test:local-pg` in `backend/` (or `DATABASE_URL=... npm test`) against a throwaway DB (e.g. `verdikt_test`). CI uses the backend migration path on startup.

## Notes

- `password_reset_tokens` has RLS enabled with **no** policies (service role only).
- `waitlist_requests` allows **INSERT** for `anon` and `authenticated` (no `SELECT` for clients); tune spam controls separately.
- Supabase migrations assume Supabase’s **`auth`** schema (`auth.users`).
