/** Published MCP package — keep in sync with mcp/package.json name field. */
export const VERDIKT_MCP_PACKAGE = "@useverdikt/mcp";

/** Cursor / Claude Code MCP config snippet (env values are placeholders). */
export function buildVerdiktMcpSnippet({ workspaceId, apiUrl }) {
  return `{
  "mcpServers": {
    "verdikt": {
      "command": "npx",
      "args": ["-y", "${VERDIKT_MCP_PACKAGE}"],
      "env": {
        "VERDIKT_API_URL": "${apiUrl}",
        "VERDIKT_API_KEY": "vdk_live_…",
        "VERDIKT_WORKSPACE_ID": "${workspaceId || "ws_…"}"
      }
    }
  }
}`;
}
