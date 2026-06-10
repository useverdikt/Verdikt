# Verdikt MCP Server

Model Context Protocol (MCP) tools so AI coding agents can certify releases through Verdikt before shipping to production.

## Setup

1. Create an API key in **Settings → Agent access** (or `POST /api/workspaces/:id/api-keys` with a human session).
2. Configure your agent runtime (Cursor, Claude Code, etc.):

```json
{
  "mcpServers": {
    "verdikt": {
      "command": "node",
      "args": ["/absolute/path/to/Verdikt MVP v1/mcp/src/index.js"],
      "env": {
        "VERDIKT_API_URL": "https://api.useverdikt.com",
        "VERDIKT_API_KEY": "vdk_live_…",
        "VERDIKT_WORKSPACE_ID": "ws_…"
      }
    }
  }
}
```

## Tools

| Tool | Purpose |
|------|---------|
| `create_release` | Open certification window |
| `post_signals` | Submit eval/QA metrics |
| `get_verdict` | Read status + blocking signals |
| `check_gate` | Merge/deploy decision (`exit_code` in gate) |
| `escalate` | Hand off to human when blocked |
| `record_outcome` | Post-prod calibration feedback |

## Typical agent flow

```
create_release(version) → post_signals(release_id, signals) → check_gate(release_id)
  → if allowed: merge
  → else: self-heal or escalate(reason)
```
