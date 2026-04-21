#!/usr/bin/env bash
# API smoke / e2e: login → thresholds → release → signals → GET → override → audit.
# Uses seeded demo user (demo@verdikt.local / demo123) and workspace ws_demo.
# Session: HttpOnly cookie jar (no Bearer JWT).
# Requires a running server (default http://localhost:8787). Example:
#   npm start   # in another terminal
#   npm run test:e2e

set -euo pipefail
BASE="${BASE_URL:-http://localhost:8787}"
WS="ws_demo"
VER="1.0.0-e2e-$(date +%s)"
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

if ! curl -sfS "$BASE/health" >/dev/null; then
  echo "Backend not reachable at $BASE. Start it with: npm start"
  exit 1
fi

echo "=== login (demo user) ==="
LOGIN_JSON=$(curl -sfS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@verdikt.local","password":"demo123"}')
echo "$LOGIN_JSON" | head -c 120
echo "..."
# Readable CSRF cookie must be echoed on mutating requests (double-submit).
CSRF=$(awk '$6=="vdk_csrf" {v=$7} END{print v}' "$COOKIE_JAR" 2>/dev/null || true)
CSRF_HEADER=()
if [ -n "$CSRF" ]; then CSRF_HEADER=( -H "X-CSRF-Token: $CSRF" ); fi

echo "=== GET /api/auth/me ==="
curl -sfS -b "$COOKIE_JAR" "$BASE/api/auth/me" | head -c 200
echo

echo "=== GET thresholds (seeds defaults for workspace) ==="
curl -sfS -b "$COOKIE_JAR" "$BASE/api/workspaces/$WS/thresholds" | head -c 500
echo

echo "=== POST release ==="
REL_JSON=$(curl -sfS -b "$COOKIE_JAR" -X POST "$BASE/api/workspaces/$WS/releases" \
  "${CSRF_HEADER[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"version\":\"$VER\",\"release_type\":\"prompt_update\",\"environment\":\"pre-prod\"}")
echo "$REL_JSON"
REL_ID=$(echo "$REL_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); if(j.release_type!=='prompt_update') process.exit(1); console.log(j.id);})")

echo "=== POST workspace integration webhook (signed) ==="
WBODY="{\"provider\":\"langsmith\",\"release_id\":\"$REL_ID\",\"payload\":{\"metrics\":{\"correctness\":92}}}"
WSIG=$(printf "%s" "$WBODY" | openssl dgst -sha256 -hmac "${WEBHOOK_SECRET:-dev-webhook-secret}" | sed 's/^.* //')
curl -sfS -X POST "$BASE/api/workspaces/$WS/integrations/evals" \
  -H "Content-Type: application/json" \
  -H "x-verdikt-signature: sha256=$WSIG" \
  -d "$WBODY" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    const j=JSON.parse(s);
    if (!j.integration || j.integration.ingest_mode !== 'workspace_webhook') process.exit(1);
    console.log('ok: workspace webhook ingest mapped', (j.integration.mapped_signal_ids||[]).join(','));
  });
"

echo "=== GET threshold suggestions (if enabled) ==="
SUG_RESP=$(curl -sS -w "\n%{http_code}" -b "$COOKIE_JAR" "$BASE/api/workspaces/$WS/threshold-suggestions" || true)
SUG_CODE=$(printf "%s" "$SUG_RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const i=s.lastIndexOf('\n');console.log(i>=0?s.slice(i+1).trim():'000');})")
SUG_JSON=$(printf "%s" "$SUG_RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const i=s.lastIndexOf('\n');console.log(i>=0?s.slice(0,i):s);})")
FIRST_SUG_ID=""
if [ "$SUG_CODE" = "200" ]; then
  echo "$SUG_JSON" | node -e "
    let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
      const j=JSON.parse(s);
      if (!Array.isArray(j.suggestions)) { console.error('invalid suggestions payload'); process.exit(1); }
      if (!j.analysis_window || typeof j.analysis_window.last_n_releases !== 'number') {
        console.error('missing analysis_window.last_n_releases'); process.exit(1);
      }
      const first = j.suggestions[0];
      if (!first) { console.log('ok: suggestions list empty'); return; }
      for (const k of ['id','signal_id','reason','confidence','current_threshold','suggested_threshold','basis_window']) {
        if (!(k in first)) { console.error('missing suggestion field:', k); process.exit(1); }
      }
      console.log('ok: suggestions count', j.suggestions.length, 'first', first.id);
    });
  "
  FIRST_SUG_ID=$(echo "$SUG_JSON" | node -e "
    let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
      const j=JSON.parse(s); console.log((j.suggestions&&j.suggestions[0]&&j.suggestions[0].id)||'');
    });
  ")
  SECOND_SUG_ID=$(echo "$SUG_JSON" | node -e "
    let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
      const j=JSON.parse(s); console.log((j.suggestions&&j.suggestions[1]&&j.suggestions[1].id)||'');
    });
  ")
elif [ "$SUG_CODE" = "404" ]; then
  echo "ok: suggestions endpoint unavailable/disabled (404)"
else
  echo "unexpected suggestions status: $SUG_CODE"
  exit 1
fi
if [ -n "$FIRST_SUG_ID" ]; then
  echo "=== POST apply threshold suggestion ==="
  curl -sfS -b "$COOKIE_JAR" -X POST "$BASE/api/workspaces/$WS/threshold-suggestions/$FIRST_SUG_ID/apply" \
    "${CSRF_HEADER[@]}" \
    -H 'Content-Type: application/json' \
    -d '{}' >/dev/null
  echo "ok: applied $FIRST_SUG_ID"
fi
if [ -n "${SECOND_SUG_ID:-}" ]; then
  echo "=== POST dismiss threshold suggestion ==="
  curl -sfS -b "$COOKIE_JAR" -X POST "$BASE/api/workspaces/$WS/threshold-suggestions/$SECOND_SUG_ID/dismiss" \
    "${CSRF_HEADER[@]}" \
    -H 'Content-Type: application/json' \
    -d '{"reason":"e2e"}' >/dev/null
  echo "ok: dismissed $SECOND_SUG_ID"
fi

echo "=== GET workspace releases (list includes new release) ==="
curl -sfS -b "$COOKIE_JAR" "$BASE/api/workspaces/$WS/releases" | REL_ID="$REL_ID" node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    const j=JSON.parse(s);
    const ids = (j.releases||[]).map(r=>r.id);
    if (!ids.includes(process.env.REL_ID)) { console.error('list missing release'); process.exit(1); }
    console.log('ok: list count', j.releases.length);
  });
"

echo "=== POST signals via integration adapter (accuracy below min → UNCERTIFIED) ==="
curl -sfS -b "$COOKIE_JAR" -X POST "$BASE/api/releases/$REL_ID/signals/integrations" \
  "${CSRF_HEADER[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"braintrust","payload":{"metrics":{"exact_match":80,"safety":95,"tone":90,"hallucination":95,"answer_relevance":90,"p95_latency":100,"latency_p99":200}}}'
echo

echo "=== GET release ==="
curl -sfS -b "$COOKIE_JAR" "$BASE/api/releases/$REL_ID" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    const j=JSON.parse(s);
    if (j.release.status !== 'UNCERTIFIED') process.exit(1);
    console.log('ok: UNCERTIFIED, signals:', j.signals.length, 'audit:', j.audit.length);
  });
"

echo "=== GET release gate (default mode) ==="
curl -sfS -b "$COOKIE_JAR" "$BASE/api/releases/$REL_ID/gate" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    const j=JSON.parse(s);
    if (!j.gate || j.gate.allowed !== false || j.gate.exit_code !== 1) process.exit(1);
    console.log('ok: gate blocked for UNCERTIFIED');
  });
"

echo "=== POST override ==="
curl -sfS -b "$COOKIE_JAR" -X POST "$BASE/api/releases/$REL_ID/override" \
  "${CSRF_HEADER[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"approver_name":"QA Lead","approver_role":"release_manager","justification":"E2E approved","metadata":{"impact_summary":"Known low-severity risk accepted for release.","mitigation_plan":"Hotfix committed and post-release monitoring enabled.","follow_up_due_date":"2026-04-30"}}'
echo

echo "=== GET release (after override) ==="
curl -sfS -b "$COOKIE_JAR" "$BASE/api/releases/$REL_ID" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    const j=JSON.parse(s);
    if (j.release.status !== 'CERTIFIED_WITH_OVERRIDE') process.exit(1);
    if (!j.override || j.override.approver_name !== 'QA Lead') process.exit(1);
    console.log('ok: CERTIFIED_WITH_OVERRIDE');
  });
"

echo "=== GET release gate (default + strict) ==="
curl -sfS -b "$COOKIE_JAR" "$BASE/api/releases/$REL_ID/gate" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    const j=JSON.parse(s);
    if (!j.gate || j.gate.allowed !== true || j.gate.exit_code !== 0) process.exit(1);
    console.log('ok: default gate allows CERTIFIED_WITH_OVERRIDE');
  });
"
curl -sfS -b "$COOKIE_JAR" "$BASE/api/releases/$REL_ID/gate?mode=strict" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    const j=JSON.parse(s);
    if (!j.gate || j.gate.allowed !== false || j.gate.exit_code !== 1) process.exit(1);
    console.log('ok: strict gate blocks override status');
  });
"

echo "=== workspace audit ==="
curl -sfS -b "$COOKIE_JAR" "$BASE/api/workspaces/$WS/audit" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
    const j=JSON.parse(s);
    const types = new Set(j.events.map(e => e.event_type));
    for (const t of ['RELEASE_CREATED','SIGNALS_INGESTED','OVERRIDE_APPROVED']) {
      if (!types.has(t)) { console.error('missing audit event:', t); process.exit(1); }
    }
    if (types.has('THRESHOLD_SUGGESTION_APPLIED') || types.has('THRESHOLD_SUGGESTION_DISMISSED') || types.has('THRESHOLD_SUGGESTED')) {
      console.log('ok: threshold suggestion audit events present');
    }
    console.log('ok: audit events', j.events.length);
  });
"

echo "PASS workspace=$WS release=$REL_ID"
