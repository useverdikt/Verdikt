# Verdikt

Release intelligence: certify AI releases against thresholds, govern overrides, and keep an immutable audit trail. This repo is a **Node.js + PostgreSQL** API (Express) and a **React (Vite) SPA** (React Router).

## Quick start

### 1. Configure the API

Copy [`backend/.env.example`](backend/.env.example) to **`backend/.env`** and set at least **`DATABASE_URL`** (PostgreSQL). See [**`backend/README.md`**](backend/README.md) for secrets, migrations, email, and production checks.

### 2. Install and run (full stack — recommended)

From the **repository root**:

```bash
npm install --prefix backend
npm install --prefix frontend
npm run dev
```

This runs the API on **`http://127.0.0.1:8787`** and Vite on **`http://127.0.0.1:5174`**, with `/api` and `/health` proxied to the backend.

### Backend or frontend only

```bash
cd backend && npm install && npm start
```

```bash
cd frontend && npm install && npm run dev
```

When you use only the frontend dev server, it still proxies `/api` and `/health` to **`127.0.0.1:8787`**, so start the backend separately or use `npm run dev` from the root.

### Tests

| Scope | Command |
| --- | --- |
| **Backend** | `npm run test:backend` or `cd backend && npm test` (uses PostgreSQL; see `backend/README.md` and `npm run test:local-pg`) |
| **Frontend unit (Vitest)** | `npm run test:frontend` or `cd frontend && npm test` (`npm run test:watch` in `frontend` for watch mode) |
| **E2E (Playwright)** | `npm run test:e2e` or `cd frontend && npm run test:e2e` — installs app + API via `concurrently`; run `npx playwright install` once |

**All tests (from root):** `npm test`

## Layout

| Path | Role |
| --- | --- |
| `backend/` | Express API, PostgreSQL, auth, webhooks, migrations in `migrations/postgres/` |
| `frontend/` | React (Vite) SPA, Playwright e2e in `frontend/e2e/` |
| `shared/` | Shared config for Node + client |
| `supabase/` | Optional local Supabase config / SQL (see `supabase/README.md`) |

## Production

Run the API and the **built** SPA (e.g. static host + Node) behind **HTTPS**. Set **`CORS_ORIGINS`**, strong **`JWT_SECRET`** / **`WEBHOOK_SECRET`**, optional **`RESEND_API_KEY`** + **`PUBLIC_APP_URL`** for password reset email, **`TRUST_PROXY=1`** behind a reverse proxy, and build the frontend with **`VITE_API_BASE`** pointing at your public API origin. Schedule logical DB backups (`backend` **`npm run db:backup`**) and monitor **`GET /health/ready`**. Details: [**`backend/README.md`**](backend/README.md).

**Access / registration:** In production-like mode, public self-service registration is **off by default**; marketing can use **`/request-access`**. Provisioning is documented under **`ALLOW_PUBLIC_REGISTRATION`** and **`npm run provision:user`** in [**`backend/README.md`**](backend/README.md).

**MVP scope:** What is fully wired vs illustrative in the UI is summarized in [**`backend/README.md`**](backend/README.md) (**MVP product surface**).
