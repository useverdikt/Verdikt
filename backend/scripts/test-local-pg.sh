#!/usr/bin/env bash
# Run backend tests against a local PostgreSQL database.
# Usage (from backend/): npm run test:local-pg
# Or: bash scripts/test-local-pg.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://127.0.0.1:5432/verdikt_test}"

if command -v createdb >/dev/null 2>&1; then
  createdb verdikt_test 2>/dev/null || true
else
  echo "Note: createdb not on PATH. Create the DB manually if needed: createdb verdikt_test" >&2
fi

npm test
