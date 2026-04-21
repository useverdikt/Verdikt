#!/usr/bin/env bash
# Local Supabase: start stack, apply migrations (db reset), write VITE_* to frontend/.env.local,
# optional test signup.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, then run this script again."
  exit 1
fi

echo "==> supabase start"
npx supabase start

echo "==> supabase db reset (runs migrations 000→003)"
npx supabase db reset

echo "==> write frontend/.env.local"
node "$ROOT/scripts/write-supabase-local-env.mjs"

EMAIL="${SUPABASE_TEST_EMAIL:-localdev@verdikt.local}"
PASSWORD="${SUPABASE_TEST_PASSWORD:-localdev123456}"

echo "==> try signup: $EMAIL"
if ! node "$ROOT/scripts/supabase-test-signup.mjs" "$EMAIL" "$PASSWORD"; then
  echo "(signup may fail if user already exists — that's OK)"
fi

echo ""
echo "Done."
echo "  1. Open frontend: npm run dev (in frontend/)"
echo "  2. Studio: http://127.0.0.1:54323 — Table Editor → public.users (row for auth user)"
echo "  3. thresholds / workspace_policies should have rows for the new workspace"
