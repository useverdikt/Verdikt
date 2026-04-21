#!/usr/bin/env bash
# Multi-startup synthetic data generator for realistic AI product flows.
# Simulates 10 AI startups across:
# - product surfaces: web app / mobile app / api-backend
# - trigger modes: pipeline webhook, github label, jira transition, env promotion, manual declaration
# - signal ingestion: integration payload mapping, manual entry, csv-like batch imports
# - providers: Braintrust, LangSmith, Datadog, Sentry
#
# Examples:
#   WEBHOOK_SECRET=dev-webhook-secret bash scripts/synth-seed.sh
#   BASE_URL=http://localhost:8792 STARTUPS=3 RELEASES_PER_STARTUP=4 WEBHOOK_SECRET=dev-webhook-secret bash scripts/synth-seed.sh

set -euo pipefail

BASE="${BASE_URL:-http://localhost:8787}"
STARTUPS="${STARTUPS:-10}"
RELEASES_PER_STARTUP="${RELEASES_PER_STARTUP:-5}"
PROFILE="${PROFILE:-mixed}" # mixed|healthy|risky
WEBHOOK_SECRET="${WEBHOOK_SECRET:-dev-webhook-secret}"
DEFAULT_PASSWORD="${PASSWORD:-demo12345}"

if ! curl -sfS "$BASE/health" >/dev/null; then
  echo "Backend not reachable at $BASE. Start it first."
  exit 1
fi

release_types=("prompt_update" "model_patch" "model_update" "policy_change" "safety_patch")
surfaces=("ai_web_app" "ai_mobile_app" "api_backend")
trigger_modes=("pipeline_webhook" "github_label" "jira_transition" "env_promotion" "manual_declaration")
ingest_modes=("integration" "manual" "csv_like")
providers=("braintrust" "langsmith" "datadog" "sentry")

clamp100() { local v="$1"; (( v < 0 )) && v=0; (( v > 100 )) && v=100; echo "$v"; }
jitter() { local base="$1" spread="$2"; echo $((base + (RANDOM % (2*spread + 1) - spread))); }
pick_idx() { local max="$1"; echo $((RANDOM % max)); }

make_metrics() {
  local acc saf tone hal rel p95 p99
  case "$PROFILE" in
    healthy)
      acc=$(clamp100 "$(jitter 92 4)"); saf=$(clamp100 "$(jitter 95 3)"); tone=$(clamp100 "$(jitter 91 4)")
      hal=$(clamp100 "$(jitter 94 4)"); rel=$(clamp100 "$(jitter 89 5)")
      p95=$(jitter 220 40); p99=$(jitter 430 80)
      ;;
    risky)
      acc=$(clamp100 "$(jitter 80 8)"); saf=$(clamp100 "$(jitter 87 7)"); tone=$(clamp100 "$(jitter 82 8)")
      hal=$(clamp100 "$(jitter 86 8)"); rel=$(clamp100 "$(jitter 79 8)")
      p95=$(jitter 340 90); p99=$(jitter 650 120)
      ;;
    *)
      acc=$(clamp100 "$(jitter 87 7)"); saf=$(clamp100 "$(jitter 92 5)"); tone=$(clamp100 "$(jitter 87 6)")
      hal=$(clamp100 "$(jitter 90 6)"); rel=$(clamp100 "$(jitter 84 7)")
      p95=$(jitter 270 75); p99=$(jitter 540 120)
      ;;
  esac
  (( p95 < 70 )) && p95=70
  (( p99 < 120 )) && p99=120
  echo "$acc,$saf,$tone,$hal,$rel,$p95,$p99"
}

register_startup_user() {
  local idx="$1"
  local email="pilot${idx}_$(date +%s)@synthetic.verdikt.local"
  local name="Startup ${idx} Team"
  local reg
  reg=$(curl -sfS -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$DEFAULT_PASSWORD\",\"name\":\"$name\"}")
  local token ws
  token=$(echo "$reg" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.token)})")
  ws=$(echo "$reg" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.user.workspace_id)})")
  echo "$email,$token,$ws"
}

create_release_by_mode() {
  local token="$1" ws="$2" version="$3" release_type="$4" trigger="$5" surface="$6" provider="$7"
  local rel_json
  if [ "$trigger" = "manual_declaration" ]; then
    rel_json=$(curl -sfS -X POST "$BASE/api/workspaces/$ws/releases" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "{\"version\":\"$version\",\"release_type\":\"$release_type\",\"environment\":\"pre-prod\",\"ai_context\":{\"surface\":\"$surface\",\"provider\":\"$provider\",\"trigger_mode\":\"$trigger\"}}")
  else
    local source
    case "$trigger" in
      pipeline_webhook) source="pipeline" ;;
      github_label) source="github_label" ;;
      jira_transition) source="jira_transition" ;;
      env_promotion) source="env_promotion" ;;
      *) source="webhook" ;;
    esac
    local body sig
    body=$(cat <<EOF
{"workspace_id":"$ws","release_ref":"rc/$version","release_type":"$release_type","environment":"pre-prod","source":"$source","mappings":{"eval_run_id":"eval/$version","sentry_release":"$version"},"ai_context":{"surface":"$surface","provider":"$provider","trigger_mode":"$trigger"},"collection_window_minutes":120}
EOF
)
    sig=$(printf "%s" "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
    rel_json=$(curl -sfS -X POST "$BASE/api/hooks/release-promoted" \
      -H "Content-Type: application/json" \
      -H "x-verdikt-signature: sha256=$sig" \
      -H "x-idempotency-key: seed:$ws:$version:$trigger" \
      -d "$body")
  fi
  local rel_id
  rel_id=$(echo "$rel_json" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log(j.id || (j.release && j.release.id) || '')})")
  echo "$rel_id"
}

ingest_signals() {
  local token="$1" ws="$2" rel_id="$3" ingest="$4" provider="$5"
  local metrics csv acc saf tone hal rel p95 p99
  metrics=$(make_metrics)
  IFS=',' read -r acc saf tone hal rel p95 p99 <<< "$metrics"
  case "$ingest" in
    integration)
      if [ $((RANDOM % 2)) -eq 0 ]; then
        curl -sfS -X POST "$BASE/api/releases/$rel_id/signals/integrations" \
          -H "Authorization: Bearer $token" \
          -H "Content-Type: application/json" \
          -d "{\"provider\":\"$provider\",\"payload\":{\"metrics\":{\"exact_match\":$acc,\"harmlessness\":$saf,\"tone\":$tone,\"answer_relevance\":$rel,\"groundedness\":$hal,\"p95_latency\":$p95,\"latency_p99\":$p99}}}" >/dev/null
      else
        local wb wsig
        wb="{\"provider\":\"$provider\",\"release_id\":\"$rel_id\",\"payload\":{\"metrics\":{\"correctness\":$acc,\"safety\":$saf,\"tone\":$tone,\"relevance\":$rel,\"hallucination\":$hal,\"p95_latency\":$p95,\"p99_latency\":$p99}}}"
        wsig=$(printf "%s" "$wb" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
        curl -sfS -X POST "$BASE/api/workspaces/$ws/integrations/evals" \
          -H "Content-Type: application/json" \
          -H "x-verdikt-signature: sha256=$wsig" \
          -d "$wb" >/dev/null
      fi
      ;;
    csv_like)
      # Mimics CSV import path by pushing a full mapped snapshot with csv source tag.
      curl -sfS -X POST "$BASE/api/releases/$rel_id/signals" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"source\":\"csv_upload\",\"signals\":{\"accuracy\":$acc,\"safety\":$saf,\"tone\":$tone,\"hallucination\":$hal,\"relevance\":$rel,\"p95latency\":$p95,\"p99latency\":$p99}}" >/dev/null
      ;;
    *)
      # manual entry
      curl -sfS -X POST "$BASE/api/releases/$rel_id/signals" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"source\":\"manual_entry\",\"signals\":{\"accuracy\":$acc,\"safety\":$saf,\"tone\":$tone,\"hallucination\":$hal,\"relevance\":$rel,\"p95latency\":$p95,\"p99latency\":$p99}}" >/dev/null
      ;;
  esac
}

for ((s=1; s<=STARTUPS; s++)); do
  startup=$(register_startup_user "$s")
  IFS=',' read -r email token ws <<< "$startup"
  surface="${surfaces[$(pick_idx ${#surfaces[@]})]}"
  provider="${providers[$(pick_idx ${#providers[@]})]}"
  echo "=== startup $s :: $email :: workspace=$ws :: surface=$surface :: provider=$provider ==="

  for ((r=1; r<=RELEASES_PER_STARTUP; r++)); do
    rt="${release_types[$(pick_idx ${#release_types[@]})]}"
    trig="${trigger_modes[$(pick_idx ${#trigger_modes[@]})]}"
    ingest="${ingest_modes[$(pick_idx ${#ingest_modes[@]})]}"
    version="startup${s}-rel${r}-$(date +%H%M%S)"
    rel_id=$(create_release_by_mode "$token" "$ws" "$version" "$rt" "$trig" "$surface" "$provider")
    if [ -z "$rel_id" ]; then
      echo "failed release create startup=$s release=$r"
      continue
    fi

    ingest_signals "$token" "$ws" "$rel_id" "$ingest" "$provider"

    status=$(curl -sfS "$BASE/api/releases/$rel_id" -H "Authorization: Bearer $token" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).release.status))")
    if [ "$status" = "UNCERTIFIED" ] && [ $((RANDOM % 2)) -eq 0 ]; then
      curl -sfS -X POST "$BASE/api/releases/$rel_id/override" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"approver_name\":\"${surface}_owner\",\"approver_role\":\"release_manager\",\"justification\":\"Synthetic override for scenario coverage.\",\"metadata\":{\"impact_summary\":\"Synthetic release below threshold accepted for realistic workflow testing.\",\"mitigation_plan\":\"Synthetic rollback and monitoring plan attached.\",\"follow_up_due_date\":\"2026-12-31\"}}" >/dev/null
      status="CERTIFIED_WITH_OVERRIDE"
    fi

    echo "  seeded $version trigger=$trig ingest=$ingest type=$rt -> $status"
  done
done

echo "DONE: seeded $STARTUPS startups x $RELEASES_PER_STARTUP releases ($((STARTUPS * RELEASES_PER_STARTUP)) total)"
