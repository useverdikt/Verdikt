import React, { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../../lib/apiClient.js";
import { api, json } from "../api.js";
import { C } from "../theme.js";
import { btnStyle } from "../styles.js";
import { Badge, Card, Spinner, EmptyState } from "../ui.jsx";

export function EnvChainPanel({ wsId }) {
  const [chains, setChains] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", environments: "dev,staging,prod", require_all: true });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setChains((await json(`/api/workspaces/${wsId}/env-chains`)).chains || []); } catch (_) {}
    finally { setLoading(false); }
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      await api(`/api/workspaces/${wsId}/env-chains`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, environments: form.environments.split(",").map((s) => s.trim()), require_all: form.require_all })
      });
      setShowCreate(false);
      await load();
    } catch (_) {}
    finally { setCreating(false); }
  };

  const deleteChain = async (chainId) => {
    await api(`/api/workspaces/${wsId}/env-chains/${chainId}`, { method: "DELETE", headers: authHeaders() });
    await load();
  };

  return (
    <Card title="Environment Certification Chains" eyebrow="MULTI-ENV PIPELINE"
      action={<button onClick={() => setShowCreate((v) => !v)} style={btnStyle(C.green)}>+ New chain</button>}>
      {showCreate && (
        <div style={{ background: C.raise, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>Create certification chain</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label className="field-label">Chain name</label>
              <input className="inp" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Production release" style={{ marginTop: 6 }} />
            </div>
            <div className="field">
              <label className="field-label">Environments (comma-separated)</label>
              <input className="inp inp-mono" value={form.environments} onChange={(e) => setForm((f) => ({ ...f, environments: e.target.value }))} style={{ marginTop: 6 }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={create} disabled={creating || !form.name} style={btnStyle(C.green)}>{creating ? "Creating…" : "Create"}</button>
            <button onClick={() => setShowCreate(false)} style={btnStyle(C.dim)}>Cancel</button>
          </div>
        </div>
      )}
      {loading ? <Spinner /> : !chains?.length ? <EmptyState msg="No chains configured. Create one to track certification across environments." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {chains.map((chain) => (
            <ChainRow key={chain.id} chain={chain} wsId={wsId} onDelete={() => deleteChain(chain.id)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ChainRow({ chain, wsId, onDelete }) {
  const [status, setStatus] = useState(null);
  const STATUS_COLOR = { complete: C.green, blocked: C.red, in_progress: C.amber, not_started: C.dim };
  const ENV_STATUS_ICON = { certified: "✓", uncertified: "✕", pending: "⧗", not_started: "○" };
  const ENV_STATUS_COLOR = { certified: C.green, uncertified: C.red, pending: C.amber, not_started: C.dim };

  useEffect(() => {
    json(`/api/workspaces/${wsId}/env-chains/${chain.id}`).then(setStatus).catch(() => {});
  }, [chain.id, wsId]);

  return (
    <div style={{ background: C.raise, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{chain.name}</span>
          {status?.overall && (
            <Badge color={STATUS_COLOR[status.overall] || C.dim} style={{ marginLeft: 8 }}>{status.overall.replace("_", " ").toUpperCase()}</Badge>
          )}
        </div>
        <button onClick={onDelete} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>✕</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {(status?.environments || chain.environments || []).map((env, i, arr) => {
          const e = typeof env === "string" ? { environment: env, status: "not_started" } : env;
          const isLast = i === arr.length - 1;
          return (
            <React.Fragment key={e.environment}>
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: (ENV_STATUS_COLOR[e.status] || C.dim) + "18", border: `2px solid ${ENV_STATUS_COLOR[e.status] || C.dim}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: ENV_STATUS_COLOR[e.status] || C.dim, margin: "0 auto" }}>
                  {ENV_STATUS_ICON[e.status] || "○"}
                </div>
                <div style={{ fontSize: 10, color: C.mid, marginTop: 4, fontFamily: C.mono }}>{e.environment}</div>
              </div>
              {!isLast && <div style={{ flex: 1, height: 2, background: e.status === "certified" ? C.green : C.border, margin: "0 4px", marginBottom: 16 }} />}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
