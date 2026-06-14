# Zizka (Mir) — partner onboarding

Partner product: [ZizkaDB](https://db.zizka.ai/) — behavioural observability for AI agents.

## Integration model

| Layer | Zizka setup |
|-------|-------------|
| **Signal source** | ZizkaDB (push via `post_signals` / API) |
| **Signal definitions** | `behavioural_drift`, `session_anomaly_rate` (workspace-owned) |
| **Thresholds** | e.g. drift ≤ 0.15, anomaly rate ≤ 0.05, marked **required** |
| **GitHub** | `verdikt:rc` label + polling GHA gate (see `docs/examples/verdikt-gate-gha.yml`) |

Verdikt is unopinionated about *which* signals matter — Mir defines behavioural metrics; Verdikt certifies against thresholds.

## Pre-call workspace setup

In **App → Signals & thresholds** (or API):

1. **Add custom signals** (or use API below):
   - `behavioural_drift` — direction **max**, threshold **0.15**, required ✓, source `zizkadb`
   - `session_anomaly_rate` — direction **max**, threshold **0.05**, required ✓, source `zizkadb`

2. **Un-require** standard AI signals Mir won't post in v1 (accuracy, safety, etc.) — toggle **Required** off, Save.

3. **Release trigger** — GitHub App + `verdikt:rc` (can do live on call).

## API seed (if UI not deployed yet)

```bash
BASE="https://api.useverdikt.com"
WS="ws_…"
TOKEN="vdk_live_…"

# Custom ZizkaDB signals
curl -sS -X POST "$BASE/api/workspaces/$WS/signal-definitions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signal_id": "behavioural_drift",
    "display_name": "Behavioural Drift",
    "direction": "max",
    "unit": "score",
    "source_id": "zizkadb",
    "required_for_certification": true,
    "threshold": { "max": 0.15 }
  }'

curl -sS -X POST "$BASE/api/workspaces/$WS/signal-definitions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signal_id": "session_anomaly_rate",
    "display_name": "Session Anomaly Rate",
    "direction": "max",
    "unit": "rate",
    "source_id": "zizkadb",
    "required_for_certification": true,
    "threshold": { "max": 0.05 }
  }'

# Optional: un-require default AI signals
curl -sS -X POST "$BASE/api/workspaces/$WS/thresholds" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "thresholds": {
      "accuracy": { "min": 85, "required_for_certification": false },
      "safety": { "min": 90, "required_for_certification": false },
      "tone": { "min": 85, "required_for_certification": false },
      "hallucination": { "min": 90, "required_for_certification": false },
      "relevance": { "min": 82, "required_for_certification": false }
    }
  }'
```

## Post signals after eval (ZizkaDB → Verdikt)

```bash
curl -sS -X POST "$BASE/api/releases/rel_…/signals" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "zizkadb",
    "signals": {
      "behavioural_drift": 0.12,
      "session_anomaly_rate": 0.03
    }
  }'
```

MCP equivalent: `post_signals(release_id, { behavioural_drift: 0.12, … })`.

## Demo run-of-show

1. Show **your** Verdikt audit trail (dogfood PR) — proof the loop runs in production.
2. Install GitHub App on Zizka repo (if ready).
3. Open test PR → label **`verdikt:rc`** → COLLECTING release opens.
4. Post ZizkaDB-style signals via API or Signal Simulator **Custom signals** panel.
5. Gate → CERTIFIED → audit record.
6. Explain roadmap: native ZizkaDB connector (auto-declared signals) after loop is proven.

## One-liner for Mir

> Connect your data source, define the signals you care about, set thresholds. Verdikt gates on whatever matters to you — we certify evidence, not code diffs.
