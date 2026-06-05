<p align="center">
  <img src="frontend/public/favicon.svg" alt="Verdikt logo" width="72" />
</p>

<h1 align="center">Verdikt</h1>

<p align="center">
Release intelligence for AI product teams.
</p>

<p align="center">
  <a href="https://useverdikt.com"><img alt="Live App" src="https://img.shields.io/badge/App-useverdikt.com-111827?style=flat&logo=vercel&logoColor=white"></a>
  <img alt="Frontend" src="https://img.shields.io/badge/React%20%2B%20Vite-2563eb?style=flat&logo=react&logoColor=white">
  <img alt="Backend" src="https://img.shields.io/badge/Express-111827?style=flat&logo=express&logoColor=white">
  <img alt="Database" src="https://img.shields.io/badge/Postgres-059669?style=flat&logo=supabase&logoColor=white">
</p>

---

Verdikt gives engineering and compliance teams a shared decision layer for AI releases: define signal thresholds, compute pass/fail verdicts, govern overrides with full rationale, and preserve an immutable audit trail.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `frontend/` | React SPA (Vite) |
| `backend/` | Express API, auth, webhooks, PostgreSQL |
| `shared/` | Shared config used by both |
| `supabase/` | Supabase migrations and local tooling |

## Quick Start

```bash
# 1. Configure environment
cp backend/.env.example backend/.env
# Set DATABASE_URL and other required vars — see backend/.env.example

# 2. Install and run
npm install --prefix backend
npm install --prefix frontend
npm run dev
```

API runs on `http://127.0.0.1:8787`, SPA on `http://127.0.0.1:5174`.

## Testing

```bash
npm test                  # all tests
npm run test:backend      # backend (PostgreSQL required)
npm run test:frontend     # frontend unit tests
npm run test:e2e          # Playwright e2e (run npx playwright install once)
```

## Docs

- [Backend](backend/README.md) — API reference, auth, webhooks, migrations, env vars
- [Supabase](supabase/README.md) — RLS, auth linkage, local stack

## Contributing

Branch from `main`, keep PRs focused, run `npm test` before opening one. Never commit `.env` files or secrets.
