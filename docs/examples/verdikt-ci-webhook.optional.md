# Optional: CI webhook for custom GHA metrics

**Not the default Verdikt flow.** Use label `verdikt:rc` + integration pull or MCP `post_signals`.

Use `POST /api/workspaces/:workspaceId/integrations/ci` only when GHA computes metrics not available in Braintrust, BrowserStack, etc.

See `backend/README.md` for the contract. Do not add runnable workflows under `.github/workflows/` unless intentional.
