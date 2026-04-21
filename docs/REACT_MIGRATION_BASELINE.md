# Phase 0 — React migration baseline

## Shell decision

- **Single bootstrap document**: `frontend/index.html` mounts `#root` and loads `src/main.jsx`. No other HTML file acts as a second SPA entry.
- **All product “pages”** are React routes under `BrowserRouter` in `frontend/src/main.jsx`.
- **Static HTML** in `frontend/public/` is legacy or non-app (see inventory). Long term, only intentional static assets (e.g. pitch deck) should remain.

## Auth model

- **JWT** is stored in **`localStorage`** under **`vdk3_auth_token`** (see `frontend/src/auth/session.js`).
- **`ProtectedRoute`** (`frontend/src/auth/ProtectedRoute.jsx`) wraps routes that require a session. If there is no JWT, the user is sent to **`/login`** with **`location.state.from`** set to the path they tried to open (path + query), so after sign-in **`LoginPage`** can return them there (defaults to **`/releases`**).
- **Public routes** (no JWT): **`/`** (marketing — `LandingPage.jsx`), `/pricing` (`PricingPage.jsx`), `/login`, `/forgot-password` (`ForgotPasswordPage.jsx` → `POST /api/auth/forgot-password`), `/reset-password` (`ResetPasswordPage.jsx` → `POST /api/auth/reset-password` with `?token=` from email or dev), `/onboarding` (register — `OnboardingPage.jsx` → `POST /api/auth/register`), `/badge` (`BadgePage.jsx` — public certification record demo).
- **Already signed in** and opening `/login`: redirected to `from` or `/releases` (`LoginPage`).

## HTML inventory (user-reachable)

Excluded: `node_modules/**`, `**/dist/**` (build output; mirrors `public/` + `index.html`).

### Repository root (`Verdikt MVP v1/*.html`)

Legacy / duplicate copies — not served by Vite dev server unless you open the file directly or host them separately. Migrate content into React, then delete or archive.

| File | Notes |
|------|--------|
| `index.html` | Legacy root landing; superseded by Vite `frontend/index.html` + React **`/`** (`LandingPage`). |
| `verdikt-dashboard.html` | **Removed** (Phase 4). Use SPA routes `/releases`, `/trends`, `/thresholds`, `/audit`. |
| `verdikt-login.html` | Legacy; app uses `/login`. |
| `verdikt-settings.html` | Duplicate of `frontend/public/` copy. |
| `verdikt-badge.html` | Legacy; use React **`/badge`** (`BadgePage.jsx`). |
| `verdikt-onboarding.html` | Legacy; app uses **`/onboarding`** (`OnboardingPage` + register API). |
| `verdikt-forgot-password.html` | Not in React yet. |
| `verdikt-pricing.html` | Legacy; canonical pricing is React **`/pricing`** (`PricingPage.jsx`). |
| `verdikt-emails.html` | **Removed** from repo root; previews live at **`/emails`** (`frontend/public/verdikt-emails.html`). |
| `verdikt-pitch-v11.html` | Pitch deck; may stay static (also copied under `frontend/public/`). |

### Vite `frontend/public/` (served at site root in dev / production)

| File | Role |
|------|------|
| `verdikt-settings.html` | Settings UI until ported to React (also embedded from `/settings`). |
| `verdikt-badge.html` | Redirect to **`/badge`**; full UI is React. |
| `verdikt-pitch-v11.html` | Static pitch (optional to keep non-React). |
| `verdikt-emails.html` | Redirect to **`/emails`**; previews are React (`EmailsPage.jsx`). |

### Vite shell only

| File | Role |
|------|------|
| `frontend/index.html` | **Only** bootstrap: `<div id="root">` + Vite script. |

## Known gaps (acceptable until later phases)

- Direct URL to **`/verdikt-settings.html`** still serves static HTML (bypasses `ProtectedRoute`). Remove when settings is fully React.
- Root-level `*.html` files are confusing duplicates; delete after migration and link checks.

## Phase 1 — Landing (`/`)

- **`LandingPage.jsx`** is the marketing home at **`/`** (hero, CTAs, link to static pitch at `/verdikt-pitch-v11.html`).
- **`App.jsx`** no longer redirects `/` → `/releases` (that path is not mounted under `App`).
- Repo-root **`index.html`** (if any) remains legacy; the live landing is the React route above.

## Phase 2 — Login

- **Canonical sign-in** is **`/login`** only (`LoginPage.jsx`). **`frontend/public/verdikt-login.html`** was removed; use **`/login`** (configure host-level redirects from old `.html` URLs in production if needed).
- **Hardening**: remember-email checkbox (`vdk3_saved_login_email` / `vdk3_remember_login_email`), **`?email=`** query support, forgot-password link → **`/forgot-password`**, show/hide password, `aria-live` for errors, document title.
- **JWT** storage unchanged (`vdk3_auth_token`).

## Phase 3 — Onboarding (register)

- **`OnboardingPage.jsx`** submits to **`POST /api/auth/register`** (same payload shape as the backend: `email`, `password`, optional `name`).
- On **201**, **`persistAuthSession`** stores JWT + user (including new **`workspace_id`**) and navigates to **`/releases`**. New workspaces are **`ensureWorkspaceSeeded`** on the server.
- **Authenticated** users hitting **`/onboarding`** are redirected to **`/releases`**.
- **`persistAuthSession`** lives in **`frontend/src/auth/persistSession.js`** and is shared with **`LoginPage`**.

## Phase 4 — Dashboard (single React shell)

- **Canonical dashboard** is **`App.jsx`** under **`ProtectedRoute`**, with primary URL **`/releases`** (sidebar: Trends → `/trends`, Thresholds → `/thresholds`, Audit → `/audit`). Legacy `?tab=` query handling in **`App.jsx`** still maps old links to these paths.
- **Repo-root `verdikt-dashboard.html` was deleted** — it duplicated the React app; use the Vite app and routes above.
- **Remaining repo-root static HTML** (if opened outside Vite) had links updated: dashboard targets → **`/releases`** (and siblings), sign-in → **`/login`**, home → **`/`**, so they do not point at the removed file.

## Phase 5 — Email previews

- **Route:** **`/emails`** (**protected**), **`EmailsPage.jsx`** — notification template previews (see **Phase 9** for full React implementation).
- **Sidebar:** App nav includes **Email previews** (✉) → **`/emails`**.
- Mock email bodies link to SPA paths: **`/badge`**, **`/`**, **`/settings`** (in footers).
- **Repo-root `verdikt-emails.html` removed**; **`frontend/public/verdikt-emails.html`** redirects to **`/emails`**.

## Phase 6 — Forgot / reset password

- **API:** `POST /api/auth/forgot-password` `{ email }` — always returns the same generic success message (no email enumeration). Stores a one-time token (hash only in DB). **`PASSWORD_RESET_RETURN_TOKEN=1`** or **`NODE_ENV=test`** causes the JSON to include **`reset_token`** and **`reset_expires_at`** for local/testing without email.
- **API:** `POST /api/auth/reset-password` `{ token, password }` — single-use, expires after 60 minutes; then login with the new password.
- **UI:** **`/forgot-password`** submits email; **`/reset-password?token=`** sets new password and redirects to **`/login`** with a success notice in **`location.state.resetNotice`**.
- **Rate limit:** Forgot-password is limited per IP (see backend `rateLimit.js`).

## Phase 7 — Pricing (`/pricing`)

- **Route:** **`/pricing`** (public), **`PricingPage.jsx`** — plans grid with monthly/annual toggle, comparison table, FAQ accordion, enterprise strip (same marketing content as legacy `verdikt-pricing.html`).
- **Data:** `frontend/src/pages/pricingData.js` holds plan tiers, comparison rows, and FAQ copy.
- **Navigation:** **`LandingPage`** header includes **Pricing** → **`/pricing`**. **`frontend/public/verdikt-settings.html`** billing CTA links to **`/pricing`** instead of static `verdikt-pricing.html`.
- **Legacy:** Repo-root **`verdikt-pricing.html`** may remain for direct file opens; the Vite app should use **`/pricing`**.

## Phase 8 — Public badge / certification record (`/badge`)

- **Route:** **`/badge`** (public), **`BadgePage.jsx`** — demo of three certification states (CERTIFIED / UNCERTIFIED / CERTIFIED WITH OVERRIDE), signal grid, embeddable SVG badges, Markdown/HTML embed snippet, print-to-PDF. Data lives in **`badgeDemoData.js`** (same demo payloads as legacy `verdikt-badge.html`); swap for API-backed records when a public cert endpoint exists.
- **Styles:** **`BadgePage.css`** — scoped under **`.badge-public-shell`** so global resets do not leak into the rest of the SPA.
- **Static redirect:** **`frontend/public/verdikt-badge.html`** redirects to **`/badge`** so old `.html` URLs still resolve.

## Phase 9 — Email previews (React, no iframe)

- **Route:** **`/emails`** (**protected**), **`EmailsPage.jsx`** — six notification templates with switcher, To/From/Subject chrome, **Copy HTML** (full document), and live preview via **`dangerouslySetInnerHTML`** (same table-based markup as before).
- **Templates:** **`emailPreviewTemplates.js`** exports **`EMAIL_PREVIEWS`**, **`emailHeader`**, **`emailFooter`** — lifted from legacy `verdikt-emails.html`.
- **Styles:** **`EmailsPage.css`** — preview chrome only, scoped under **`.emails-preview-root`** (noise overlay retained on the preview shell).
- **Static redirect:** **`frontend/public/verdikt-emails.html`** redirects to **`/emails`** (auth still required for the SPA route).

## Route map (updated)

| Path | Guard |
|------|--------|
| `/` | Public (`LandingPage`) |
| `/pricing` | Public (`PricingPage`) |
| `/login` | Public |
| `/forgot-password` | Public |
| `/reset-password` | Public |
| `/onboarding` | Public (register → session → `/releases`) |
| `/settings` | **Protected** |
| `/emails` | **Protected** (`EmailsPage` — HTML template previews) |
| `/badge` | Public (`BadgePage` — certification record demo) |
| `/*` (incl. `/releases`, `/trends`, …) | **Protected** (`App`) |
