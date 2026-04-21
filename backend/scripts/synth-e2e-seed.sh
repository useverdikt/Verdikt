#!/usr/bin/env bash
# Seed realistic end-to-end release lifecycle data.
# Simulates: release trigger webhook -> eval ingest -> delivery signals -> verdict -> optional override.
#
# Usage:
#   BASE_URL=http://localhost:8792 WEBHOOK_SECRET=dev-webhook-secret bash scripts/synth-e2e-seed.sh
#   COUNT=12 PROFILE=mixed npm run seed:e2e

set -euo pipefail

BASE="${BASE_URL:-http://localhost:8787}"
WS="${WORKSPACE_ID:-ws_demo}"
COUNT="${COUNT:-10}"
PROFILE="${PROFILE:-mixed}" # mixed|healthy|risky
WEBHOOK_SECRET="${WEBHOOK_SECRET:-dev-webhook-secret}"
EMAIL="${EMAIL:-demo@verdikt.local}"
PASSWORD="${PASSWORD:-demo123}"
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

if ! curl -sfS "$BASE/health" >/dev/null; then
  echo "Backend not reachable at $BASE. Start it first."
  exit 1
fi

echo "=== e2e seed login ==="
curl -sfS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null
CSRF=$(awk '$6=="vdk_csrf" {v=$7} END{print v}' "$COOKIE_JAR" 2>/dev/null || true)
AUTH=( -b "$COOKIE_JAR" )
if [ -n "$CSRF" ]; then AUTH+=( -H "X-CSRF-Token: $CSRF" ); fi

types=("prompt_update" "model_patch" "model_update" "policy_change" "safety_patch")
envs=("pre-prod" "uat")

pick_type() {
  echo "${types[$((RANDOM % ${#types[@]}))]}"
}

pick_env() {
  echo "${envs[$((RANDOM % ${#envs[@]}))]}"
}

clamp100() {
  local v=$1
  (( v < 0 )) && v=0
  (( v > 100 )) && v=100
  echo "$v"
}

jitter() {
  local base=$1 spread=$2
  local delta=$((RANDOM % (2 * spread + 1) - spread))
  echo $((base + delta))
}

for ((i=1; i<=COUNT; i++)); do
  rt="$(pick_type)"
  env="$(pick_env)"
  ver="seed-e2e-$(date +%Y%m%d)-$i"
  ref="rc/$ver"

  # 1) trigger release via signed webhook to mimic CI/CD promotion.
  BODY=$(cat <<EOF
{"workspace_id":"$WS","release_ref":"$ref","release_type":"$rt","environment":"$env","source":"github_tag","mappings":{"eval_run_id":"eval/$ver","prompt_bundle_id":"pb/$ver"},"ai_context":{"model_version":"$ver","prompt_bundle":"pb/$ver","dataset_version":"ds-v1"},"collection_window_minutes":120}
EOF
)
  SIG=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
  REL_JSON=$(curl -sfS -X POST "$BASE/api/hooks/release-promoted" \
    -H "Content-Type: application/json" \
    -H "x-verdikt-signature: sha256=$SIG" \
    -H "x-idempotency-key: seed:$WS:$ref" \
    -d "$BODY")
  REL_ID=$(echo "$REL_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); console.log(j.id || (j.release && j.release.id) || '');})")
  if [ -z "$REL_ID" ]; then
    echo "failed to resolve release id for $ver"
    exit 1
  fi

  # 2) eval ingest via signed workspace integration webhook.
  case "$PROFILE" in
    healthy)
      acc=$(clamp100 "$(jitter 92 3)"); saf=$(clamp100 "$(jitter 95 3)"); tone=$(clamp100 "$(jitter 91 3)"); relv=$(clamp100 "$(jitter 88 4)"); hal=$(clamp100 "$(jitter 94 3)")
      ;;
    risky)
      acc=$(clamp100 "$(jitter 80 7)"); saf=$(clamp100 "$(jitter 87 7)"); tone=$(clamp100 "$(jitter 82 6)"); relv=$(clamp100 "$(jitter 79 7)"); hal=$(clamp100 "$(jitter 86 7)")
      ;;
    *)
      acc=$(clamp100 "$(jitter 87 6)"); saf=$(clamp100 "$(jitter 92 5)"); tone=$(clamp100 "$(jitter 87 5)"); relv=$(clamp100 "$(jitter 84 6)"); hal=$(clamp100 "$(jitter 90 6)")
      ;;
  esac

  W_PAYLOAD=$(cat <<EOF
{"provider":"braintrust","release_id":"$REL_ID","payload":{"metrics":{"exact_match":$acc,"harmlessness":$saf,"tone":$tone,"answer_relevance":$relv,"groundedness":$hal}}}
EOF
)
  W_SIG=$(printf "%s" "$W_PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
  curl -sfS -X POST "$BASE/api/workspaces/$WS/integrations/evals" \
    -H "Content-Type: application/json" \
    -H "x-verdikt-signature: sha256=$W_SIG" \
    -d "$W_PAYLOAD" >/dev/null

  # 3) delivery/runtime signals via authenticated endpoint.
  p95=$(jitter 260 90); p99=$(jitter 520 140)
  (( p95 < 80 )) && p95=80
  (( p99 < 120 )) && p99=120
  curl -sfS -X POST "$BASE/api/releases/$REL_ID/signals" \
    "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"source\":\"synth_delivery\",\"signals\":{\"p95latency\":$p95,\"p99latency\":$p99}}" >/dev/null

  # 4) optional override when uncertified.
  STATUS=$(curl -sfS -b "$COOKIE_JAR" "$BASE/api/releases/$REL_ID" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).release.status))")
  if [ "$STATUS" = "UNCERTIFIED" ] && [ $((RANDOM % 2)) -eq 0 ]; then
    curl -sfS -X POST "$BASE/api/releases/$REL_ID/override" \
      "${AUTH[@]}" \
      -H "Content-Type: application/json" \
      -d "{\"approver_name\":\"Pilot Seeder\",\"approver_role\":\"vp_engineering\",\"justification\":\"Seeded override for realistic audit trail.\",\"metadata\":{\"impact_summary\":\"Seeded known-risk release for dashboard trend validation.\",\"mitigation_plan\":\"Seeded mitigation and monitoring actions attached to release.\",\"follow_up_due_date\":\"2026-12-31\"}}" >/dev/null
    STATUS="CERTIFIED_WITH_OVERRIDE"
  fi

  echo "seeded $ver [$rt/$env] -> $STATUS (acc=$acc rel=$relv p95=$p95)"
done

echo "DONE: seeded $COUNT full-lifecycle releases in workspace=$WS"
