#!/usr/bin/env bash
# Deterministic multi-scenario seed for workspace ws_demo (demo@verdikt.local).
# Covers: webhook + manual ingest, COLLECTING, CERTIFIED, UNCERTIFIED (threshold +
# regression), override, production feedback + alignment, intelligence decisions/outcomes.
#
# Prerequisites: API up, migrations applied, npm run seed:demos (demo user vp_engineering).
# Supabase-only SPA: ensure public.users password works with POST /api/auth/login for this script,
# or use a JWT from your auth flow.
#
# Usage:
#   cd backend && WEBHOOK_SECRET=dev-webhook-secret npm run seed:demo:full
#   DEMO_SEED_TAG=custom-tag npm run seed:demo:full   # unique idempotency keys per run
#
set -euo pipefail

BASE="${BASE_URL:-http://localhost:8787}"
WS="${WORKSPACE_ID:-ws_demo}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-dev-webhook-secret}"
EMAIL="${EMAIL:-demo@verdikt.local}"
PASSWORD="${PASSWORD:-demo123}"
TAG="${DEMO_SEED_TAG:-$(date +%Y%m%d-%H%M%S)}"
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

if ! curl -sfS "$BASE/health" >/dev/null; then
  echo "Backend not reachable at $BASE. Start it first."
  exit 1
fi

sign_body() {
  printf "%s" "$1" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //'
}

echo "=== demo full seed login ($EMAIL) ==="
curl -sfS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null
CSRF=$(awk '$6=="vdk_csrf" {v=$7} END{print v}' "$COOKIE_JAR" 2>/dev/null || true)
AUTH=( -b "$COOKIE_JAR" )
if [ -n "$CSRF" ]; then AUTH+=( -H "X-CSRF-Token: $CSRF" ); fi

promote() {
  local ref="$1" rt="$2" env="$3" win="${4:-120}" idem="$5"
  local BODY
  BODY=$(cat <<EOF
{"workspace_id":"$WS","release_ref":"$ref","release_type":"$rt","environment":"$env","source":"demo_seed","mappings":{"eval_run_id":"eval/$ref","demo_tag":"$TAG"},"ai_context":{"demo_scenario":"$idem"},"collection_window_minutes":$win}
EOF
)
  local SIG
  SIG=$(sign_body "$BODY")
  curl -sfS -X POST "$BASE/api/hooks/release-promoted" \
    -H "Content-Type: application/json" \
    -H "x-verdikt-signature: sha256=$SIG" \
    -H "x-idempotency-key: demo-full:$WS:$idem" \
    -d "$BODY"
}

eval_braintrust() {
  local rel_id="$1"
  local acc="$2" saf="$3" tone="$4" hal="$5" relv="$6"
  local W_PAYLOAD SIG
  W_PAYLOAD=$(cat <<EOF
{"provider":"braintrust","release_id":"$rel_id","payload":{"metrics":{"exact_match":$acc,"harmlessness":$saf,"tone":$tone,"answer_relevance":$relv,"groundedness":$hal}}}
EOF
)
  SIG=$(sign_body "$W_PAYLOAD")
  curl -sfS -X POST "$BASE/api/workspaces/$WS/integrations/evals" \
    -H "Content-Type: application/json" \
    -H "x-verdikt-signature: sha256=$SIG" \
    -d "$W_PAYLOAD" >/dev/null
}

post_latency() {
  local rel_id="$1" p95="$2" p99="$3"
  curl -sfS -X POST "$BASE/api/releases/$rel_id/signals" \
    "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"demo_seed\",\"signals\":{\"p95latency\":$p95,\"p99latency\":$p99}}" >/dev/null
}

release_id_from() {
  node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s); console.log(j.id || (j.release && j.release.id) || '');}catch(_){ console.log(''); }});"
}

get_status() {
  curl -sfS -b "$COOKIE_JAR" "$BASE/api/releases/$1" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).release.status))"
}

echo "--- 1) COLLECTING (long window, eval only — missing latency) ---"
P1=$(promote "rc/demo-collect-$TAG" "model_update" "pre-prod" 10080 "collect-$TAG")
R1=$(echo "$P1" | release_id_from)
eval_braintrust "$R1" 90 93 88 91 87
echo "  -> $R1 $(get_status "$R1") (expected COLLECTING)"

echo "--- 2) CERTIFIED (uat, healthy) ---"
P2=$(promote "rc/demo-cert-$TAG" "model_update" "uat" 120 "cert-$TAG")
R2=$(echo "$P2" | release_id_from)
eval_braintrust "$R2" 92 95 90 93 89
post_latency "$R2" 240 480
echo "  -> $R2 $(get_status "$R2")"

echo "--- 3) Baseline CERTIFIED for regression (accuracy 96) ---"
P_BASE=$(promote "rc/demo-baseline-$TAG" "prompt_update" "pre-prod" 120 "baseline-$TAG")
R_BASE=$(echo "$P_BASE" | release_id_from)
eval_braintrust "$R_BASE" 96 95 92 94 90
post_latency "$R_BASE" 200 450
echo "  -> baseline $R_BASE $(get_status "$R_BASE")"

echo "--- 4) UNCERTIFIED — absolute threshold (low accuracy) ---"
P3=$(promote "rc/demo-abs-fail-$TAG" "safety_patch" "pre-prod" 120 "absfail-$TAG")
R3=$(echo "$P3" | release_id_from)
eval_braintrust "$R3" 78 94 88 92 86
post_latency "$R3" 250 500
echo "  -> $R3 $(get_status "$R3")"

echo "--- 5) UNCERTIFIED — latency SLO breach ---"
P4=$(promote "rc/demo-lat-fail-$TAG" "model_patch" "uat" 120 "latfail-$TAG")
R4=$(echo "$P4" | release_id_from)
eval_braintrust "$R4" 91 93 87 92 88
post_latency "$R4" 450 650
echo "  -> $R4 $(get_status "$R4")"

echo "--- 6) UNCERTIFIED — regression vs prior certified baseline ---"
P5=$(promote "rc/demo-regress-$TAG" "prompt_update" "pre-prod" 120 "regress-$TAG")
R5=$(echo "$P5" | release_id_from)
eval_braintrust "$R5" 86 95 91 93 88
post_latency "$R5" 220 480
echo "  -> $R5 $(get_status "$R5")"

echo "--- 7) UNCERTIFIED then CERTIFIED_WITH_OVERRIDE ---"
P6=$(promote "rc/demo-override-$TAG" "policy_change" "production" 120 "override-$TAG")
R6=$(echo "$P6" | release_id_from)
eval_braintrust "$R6" 79 93 86 90 84
post_latency "$R6" 260 490
ST6=$(get_status "$R6")
if [ "$ST6" = "UNCERTIFIED" ]; then
  curl -sfS -X POST "$BASE/api/releases/$R6/override" "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"approver_name\":\"Demo VP\",\"approver_role\":\"vp_engineering\",\"justification\":\"Seeded approval for dashboard audit trail and gate strict-mode comparison.\",\"metadata\":{\"impact_summary\":\"Known eval gap in legacy eval set; production monitors green.\",\"mitigation_plan\":\"Expand eval coverage next sprint; track incident INC-DEMO-1.\",\"follow_up_due_date\":\"2026-12-31\"}}" >/dev/null
  echo "  -> $R6 $(get_status "$R6")"
else
  echo "  -> expected UNCERTIFIED before override, got $ST6"
fi

echo "--- 8) Manual API release (COLLECTING-like path) ---"
MAN_JSON=$(curl -sfS -X POST "$BASE/api/workspaces/$WS/releases" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"version\":\"manual-demo-$TAG\",\"release_type\":\"policy_change\",\"environment\":\"staging\",\"ai_context\":{\"origin\":\"manual_seed\"}}")
RM=$(echo "$MAN_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).id))")
curl -sfS -X POST "$BASE/api/releases/$RM/signals/integrations" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"provider":"braintrust","payload":{"metrics":{"exact_match":89,"harmlessness":92}},"source":"demo_seed"}' >/dev/null
echo "  -> $RM $(get_status "$RM") (partial ingest / still collecting if window open)"

echo "--- 9) Production feedback + alignment (uses certified R2) ---"
curl -sfS -X POST "$BASE/api/releases/$R2/production-signals" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"signals\":{\"error_rate\":2.2,\"p95latency\":2100},\"source\":\"demo_post_deploy\"}" >/dev/null
curl -sfS -X POST "$BASE/api/releases/$R2/production-signals/align" "${AUTH[@]}" >/dev/null || true
curl -sfS -X PUT "$BASE/api/releases/$R2/production-signals/incident" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"incident_ref":"DEMO-INC-LINK"}' >/dev/null || true
echo "  -> production signals on $R2"

echo "--- 10) Intelligence hub: decision + outcome (R2) ---"
curl -sfS -X POST "$BASE/api/releases/$R2/intelligence/decision" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"decision":"applied","notes":"Demo seed: recommendation applied for release train.","actor":"demo"}' >/dev/null
curl -sfS -X POST "$BASE/api/releases/$R2/intelligence/outcome" "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"label":"followup_met","notes":"Demo seed outcome recorded.","observed_at":"2026-04-15T12:00:00.000Z"}' >/dev/null
echo "  -> intelligence annotations on $R2"

echo "=== demo full seed complete (tag=$TAG) ==="
echo "Releases touched: COLLECTING=$R1 CERT=$R2 BASELINE=$R_BASE ABS_FAIL=$R3 LAT_FAIL=$R4 REGRESS=$R5 OVERRIDE=$R6 MANUAL=$RM"
echo "Use a new DEMO_SEED_TAG to avoid webhook idempotency reuse on re-runs."
