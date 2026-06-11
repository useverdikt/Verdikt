#!/usr/bin/env bash
# Probe Verdikt gate by commit SHA (same contract as GHA verdikt-gate job).
#
# Usage:
#   export VERDIKT_API_URL=https://api.useverdikt.com
#   export VERDIKT_API_KEY=vdk_live_…
#   export VERDIKT_WORKSPACE_ID=ws_…
#   ./scripts/dogfood-gate-probe.sh <commit_sha> <pr_number> <owner> <repo>
#
set -euo pipefail

SHA="${1:?commit_sha}"
PR="${2:?pr_number}"
OWNER="${3:?github_owner}"
REPO="${4:?github_repo}"
BASE="${VERDIKT_API_URL:-https://api.useverdikt.com}"
KEY="${VERDIKT_API_KEY:?VERDIKT_API_KEY}"
WS="${VERDIKT_WORKSPACE_ID:?VERDIKT_WORKSPACE_ID}"

URL="${BASE%/}/api/workspaces/${WS}/gate"
QUERY="commit_sha=${SHA}&pr_number=${PR}&github_owner=${OWNER}&github_repo=${REPO}&mode=default"

echo "GET ${URL}?${QUERY}"
RESP=$(curl -sS -w "\nHTTP_CODE:%{http_code}" -H "Authorization: Bearer ${KEY}" "${URL}?${QUERY}")
BODY=$(echo "$RESP" | sed '/^HTTP_CODE:/d')
CODE=$(echo "$RESP" | grep '^HTTP_CODE:' | cut -d: -f2)

echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
echo "HTTP $CODE"

if [ "$CODE" = "404" ]; then
  echo "→ No cert window for this SHA. Apply verdikt:rc on the PR first."
  exit 1
fi

EXIT=$(echo "$BODY" | jq -r '.gate.exit_code // 1')
ACTION=$(echo "$BODY" | jq -r '.action // "unknown"')
echo "action=$ACTION exit_code=$EXIT"
exit "$EXIT"
