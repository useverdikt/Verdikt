# Verdikt MVP

Release intelligence: certify AI releases against thresholds, govern overrides, and keep an immutable audit trail. This repo is a **Node.js + SQLite API** and a **React (Vite) SPA**.

## Quick start

### Backend API

```bash
cd backend
npm install
npm start
```

Defaults to `http://127.0.0.1:8787`. See [`backend/README.md`](backend/README.md) for **`JWT_SECRET`**, **`WEBHOOK_SECRET`**, **`CORS_ORIGINS`** (required in production-like mode), migrations, backups (`npm run db:backup`), **`/health`** vs **`/health/ready`**, and auth routes.

### Frontend (dev)

```bash
cd frontend
npm install
npm run dev
```

Vite serves the SPA (port **5174**) and proxies `/api` and `/health` to the backend when it runs locally.

### Tests

- **Backend:** `cd backend && npm test`
- **Frontend unit (Vitest):** `cd frontend && npm test` — covers onboarding verdict helpers, `apiBase`, and `session` utilities (`npm run test:watch` for watch mode).
- **E2E (Playwright, starts API + Vite):** `cd frontend && npm run test:e2e` — install browsers once with `npx playwright install`

## Layout

| Path        | Role                                      |
| ----------- | ----------------------------------------- |
| `backend/`  | Express API, SQLite, JWT, webhooks      |
| `frontend/` | React Router SPA                          |
| `shared/`   | Shared config / helpers for Node + client |

Production deploys should run the API and static assets behind HTTPS, set **`CORS_ORIGINS`**, strong **`JWT_SECRET`** / **`WEBHOOK_SECRET`**, **`RESEND_API_KEY`** + **`PUBLIC_APP_URL`** for password reset email, **`TRUST_PROXY=1`** behind a reverse proxy, and the frontend build’s **`VITE_API_BASE`** to your API origin. Schedule DB backups and monitor **`/health/ready`**.

**Design-partner phase:** public self-service registration is **off by default** in production-like backend mode; marketing points to **`/request-access`**, and new companies are provisioned with **`npm run provision:user`** (see [`backend/README.md`](backend/README.md) **`ALLOW_PUBLIC_REGISTRATION`**).

**Product honesty (MVP):** what is real API vs demo UI is summarized in [`backend/README.md`](backend/README.md) under **MVP product surface (what is wired vs illustrative)**.
