import React, { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../../settingsClient.js";

export default function AgentAccessSection({ section, wsId, navigate, toast }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState(null);

  const loadKeys = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    try {
      const out = await apiGet(`/api/workspaces/${wsId}/api-keys`, { navigate });
      setKeys(Array.isArray(out.api_keys) ? out.api_keys : []);
    } catch (_) {
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, [wsId, navigate]);

  useEffect(() => {
    if (section === "agent") void loadKeys();
  }, [section, loadKeys]);

  async function handleCreate() {
    const name = newKeyName.trim();
    if (!name) {
      toast("Enter a name for this key");
      return;
    }
    setCreating(true);
    try {
      const out = await apiPost(`/api/workspaces/${wsId}/api-keys`, { name }, { navigate });
      setRevealedKey(out.api_key);
      setNewKeyName("");
      await loadKeys();
      toast("API key created — copy it now");
    } catch (e) {
      toast(e?.message || "Could not create API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId) {
    if (!window.confirm("Revoke this API key? Agent runtimes using it will stop working.")) return;
    try {
      await apiDelete(`/api/workspaces/${wsId}/api-keys/${keyId}`, { navigate });
      await loadKeys();
      toast("API key revoked");
    } catch (e) {
      toast(e?.message || "Could not revoke key");
    }
  }

  function copyText(text) {
    void navigator.clipboard?.writeText(text);
    toast("Copied to clipboard");
  }

  const mcpSnippet = `{
  "mcpServers": {
    "verdikt": {
      "command": "node",
      "args": ["…/mcp/src/index.js"],
      "env": {
        "VERDIKT_API_URL": "${window.location.origin.includes("localhost") ? "http://127.0.0.1:8787" : "https://api.useverdikt.com"}",
        "VERDIKT_API_KEY": "vdk_live_…",
        "VERDIKT_WORKSPACE_ID": "${wsId || "ws_…"}"
      }
    }
  }
}`;

  const ghaSnippet = `# .github/workflows/verdikt-ci.yml — see repo: .github/workflows/verdikt-post-signals.example.yml
# Secrets: VERDIKT_WEBHOOK_SECRET, VERDIKT_WORKSPACE_ID
# Posts signals to: POST /api/workspaces/${wsId || "ws_…"}/integrations/ci
# Matches release by commit_sha (+ pr_number, repo) — same window as verdikt:rc label`;

  return (
    <div className={`section${section === "agent" ? " active" : ""}`} id="panel-agent">
      <div className="section-header">
        <div className="section-eyebrow">Agentic</div>
        <h1 className="section-h1">
          <em>Agent access</em>
        </h1>
        <p className="section-desc">
          API keys and MCP configuration for coding agents (Cursor, Claude Code) to certify releases autonomously.
        </p>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">API keys</div>
            <div className="sblock-desc">Agents authenticate with Bearer tokens. Keys are shown once at creation.</div>
          </div>
        </div>
        <div className="sblock-body">
          <div className="field-row" style={{ marginBottom: 16 }}>
            <input
              className="gov-input"
              placeholder="Key name (e.g. cursor-prod)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              style={{ flex: 1, maxWidth: 280 }}
            />
            <button type="button" className="btn-primary" disabled={creating} onClick={() => void handleCreate()}>
              {creating ? "Creating…" : "Generate key"}
            </button>
          </div>

          {revealedKey ? (
            <div className="callout-warn" style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Copy this key now — it won&apos;t be shown again</div>
              <code style={{ wordBreak: "break-all", display: "block", marginBottom: 8 }}>{revealedKey}</code>
              <button type="button" className="btn-ghost accent" onClick={() => copyText(revealedKey)}>
                Copy key
              </button>
              <button type="button" className="btn-ghost" style={{ marginLeft: 8 }} onClick={() => setRevealedKey(null)}>
                Dismiss
              </button>
            </div>
          ) : null}

          {loading ? (
            <p className="muted">Loading keys…</p>
          ) : keys.length === 0 ? (
            <p className="muted">No API keys yet. Generate one for your agent runtime.</p>
          ) : (
            <div className="source-list">
              {keys.map((k) => (
                <div key={k.id} className="source-row">
                  <div className="source-info">
                    <div className="source-name">{k.name}</div>
                    <div className="source-detail">
                      {k.masked_key || k.key_prefix} · created {k.created_at?.slice(0, 10) || "—"}
                      {k.last_used_at ? ` · last used ${k.last_used_at.slice(0, 10)}` : ""}
                    </div>
                  </div>
                  <div className="source-status" style={{ color: k.active ? "#22c55e" : "#94a3b8" }}>
                    {k.active ? "Active" : "Revoked"}
                  </div>
                  <div className="source-actions">
                    {k.active ? (
                      <button type="button" className="btn-ghost danger" onClick={() => void handleRevoke(k.id)}>
                        Revoke
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">MCP server</div>
            <div className="sblock-desc">Add Verdikt to Cursor or Claude Code via Model Context Protocol.</div>
          </div>
          <button type="button" className="btn-ghost accent" onClick={() => copyText(mcpSnippet)}>
            Copy config
          </button>
        </div>
        <div className="sblock-body">
          <pre className="code-block" style={{ overflow: "auto", fontSize: 12 }}>
            {mcpSnippet}
          </pre>
          <p className="muted" style={{ marginTop: 12 }}>
            Production flow: apply <code>verdikt:rc</code> on the PR (or <code>create_release</code> with{" "}
            <code>commit_sha</code> + <code>pr_number</code>) → CI posts signals → agent calls{" "}
            <code>check_gate</code> and reads <code>action</code> (<code>merge</code> | <code>self_heal</code> |{" "}
            <code>escalate</code>).
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            Full playbook: <code>mcp/README.md</code> · GHA example:{" "}
            <code>.github/workflows/verdikt-post-signals.example.yml</code>
          </p>
        </div>
      </div>

      <div className="sblock">
        <div className="sblock-head">
          <div>
            <div className="sblock-title">GitHub Actions CI webhook</div>
            <div className="sblock-desc">
              Post test/eval signals from GHA after your PR runs. Verdikt matches by{" "}
              <code>commit_sha</code> to the same cert window as the label trigger.
            </div>
          </div>
          <button type="button" className="btn-ghost accent" onClick={() => copyText(ghaSnippet)}>
            Copy notes
          </button>
        </div>
        <div className="sblock-body">
          <pre className="code-block" style={{ overflow: "auto", fontSize: 12 }}>
            {ghaSnippet}
          </pre>
          <p className="muted" style={{ marginTop: 12 }}>
            Set secrets <code>VERDIKT_WEBHOOK_SECRET</code> and <code>VERDIKT_WORKSPACE_ID</code> in your app repo.
            See <code>backend/README.md</code> for the CI webhook contract.
          </p>
        </div>
      </div>
    </div>
  );
}
