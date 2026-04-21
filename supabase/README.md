# Supabase (Postgres + migrations + RLS)

This folder targets **Supabase** (hosted Postgres + Auth + RLS) alongside the Vite SPA. The **Express backend uses PostgreSQL** (`DATABASE_URL`); this directory holds Supabase-specific SQL (RLS, `auth` linkage) that you apply in the Supabase project or local stack.

## Migrations (run in order)

| File | Purpose |
|------|---------|
| `migrations/20260415000000_verdikt_initial.sql` | Full schema (SQLite → Postgres types). |
| `migrations/20260415000001_auth_linkage.sql` | `users.auth_user_id` → `auth.users(id)`. |
| `migrations/20260415000002_rls.sql` | RLS + helper functions + grants. |
| `migrations/20260415000003_auth_user_trigger.sql` | Nullable `password_hash`; trigger on `auth.users` → `public.users` + threshold/policy seed. |

## App integration (this repo)

- **Frontend:** If `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, **Login** uses `signInWithPassword`, then **`POST /api/auth/session-from-supabase`** exchanges the Supabase `access_token` for the same **HttpOnly Express session cookies** as email/password login (so `/api/*` works). Otherwise the Express `/api/auth/login` path is used.
- **Protected routes:** With Supabase configured, the SPA verifies the Supabase session, then **session exchange** ensures the backend cookie is set. **GET /api/auth/me** loads the user row from **PostgreSQL** via `DATABASE_URL`.
- **New Supabase signups:** The trigger creates `public.users` and default workspace rows. Email confirmation settings in the Supabase dashboard still apply before `auth.users` gets an insert.

### Backend env (session exchange + optional Postgres auth lookup)

- **`SUPABASE_JWT_SECRET`** — Supabase Dashboard → **Settings → API → JWT Secret** (not the anon key). Required for `POST /api/auth/session-from-supabase`.
- **`DATABASE_URL`** — **Required** for the Express API: all routes use this PostgreSQL connection (same DB can be Supabase Postgres; use the pooler URI for server apps).

**Cloud:** Supabase Dashboard → SQL Editor → paste each file in order, or use **CLI** linked to the project:

```bash
supabase link --project-ref <ref>
supabase db push
```

**Local:** `supabase start` then `supabase db reset` (applies migrations + `seed.sql`).

One-shot (from repo root, **Docker Desktop running**):

```bash
bash scripts/supabase-local-bootstrap.sh
```

Or from `frontend/`: `npm run supabase:local` — starts the stack, runs `db reset` (migrations **000→003**), writes `frontend/.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and attempts a test signup (`localdev@verdikt.local` / `localdev123456`, override with `SUPABASE_TEST_EMAIL` / `SUPABASE_TEST_PASSWORD`). Then open Studio at `http://127.0.0.1:54323` and confirm `public.users` and workspace seed rows.

To refresh env only after the stack is already up:

```bash
node scripts/write-supabase-local-env.mjs
```

## Hosted Auth URLs (dashboard)

For a **cloud** project: **Authentication → URL configuration** — add **Site URL** and **Redirect URLs** for your app (e.g. `http://localhost:5173`, `https://<your-app>.vercel.app`, and Vercel preview URLs if you use them). This is not stored in `config.toml` for hosted Supabase.

## Environment

- **Frontend (Vercel):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (only the anon key in the browser).
- **Backend:** `SUPABASE_JWT_SECRET` (session exchange). **`DATABASE_URL`** for Postgres when Express should resolve users from Supabase DB (use the **pooler** connection string for server apps). Prefer the **anon/service role** separation documented by Supabase; never put the service role in Vite.

## Auth

The **`on_auth_user_created`** trigger sets **`public.users.auth_user_id`** and seeds the workspace. For RLS, policies use `auth.uid()`; keep **`auth_user_id`** in sync with Auth. Legacy Express-only users may need a one-time backfill.

## Express + Supabase (data layer)

The **REST API** reads and writes **PostgreSQL** only (`backend/src/database`, `pg` pool, `DATABASE_URL`). Schema for new installs is applied from **`backend/migrations/postgres/`** on startup.

**Supabase migrations** in this folder add **RLS**, **`auth.users` linkage**, and dashboard-oriented policies on top of the same logical schema where applicable. Hardening or moving specific reads to PostgREST / Edge Functions is optional follow-up work—not a SQLite dual path.

**Tests:** `npm run test:local-pg` (or `DATABASE_URL=... npm test`) against a throwaway DB (e.g. `verdikt_test`).

## Notes

- `password_reset_tokens` has RLS enabled with **no** policies (service role only).
- `waitlist_requests` allows **INSERT** for `anon` and `authenticated` (no `SELECT` for clients); tune spam controls separately.
- Migrations assume Supabase’s **`auth`** schema (`auth.users`).
