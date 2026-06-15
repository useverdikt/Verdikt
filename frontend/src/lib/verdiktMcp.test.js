import { describe, expect, it } from "vitest";
import { VERDIKT_MCP_PACKAGE, buildVerdiktMcpSnippet } from "./verdiktMcp.js";

describe("buildVerdiktMcpSnippet", () => {
  it("uses npx with the published package name", () => {
    const snippet = buildVerdiktMcpSnippet({
      workspaceId: "ws_abc123",
      apiUrl: "https://api.useverdikt.com"
    });
    expect(snippet).toContain('"command": "npx"');
    expect(snippet).toContain(`"${VERDIKT_MCP_PACKAGE}"`);
    expect(snippet).toContain("ws_abc123");
    expect(snippet).not.toContain("mcp/src/index.js");
  });
});
