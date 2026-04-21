import React, { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../../lib/apiClient.js";
import { api, json } from "../api.js";
import { C } from "../theme.js";
import { btnStyle } from "../styles.js";
import { Card, Spinner } from "../ui.jsx";

export function VcsPanel({ wsId }) {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ provider: "github", access_token: "", owner: "", repo: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await json(`/api/workspaces/${wsId}/vcs-integration`);
      if (!data.error) { setCfg(data); setForm((f) => ({ ...f, provider: data.provider, owner: data.owner, repo: data.repo })); }
    } catch (_) {}
    finally { setLoading(false); }
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setMsg("");
    try {
      const res = await api(`/api/workspaces/${wsId}/vcs-integration`, { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (res.ok) { setMsg("Saved"); await load(); } else { const e = await res.json(); setMsg(e.error || "Save failed"); }
    } catch (_) { setMsg("Network error"); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    await api(`/api/workspaces/${wsId}/vcs-integration`, { method: "DELETE", headers: authHeaders() });
    setCfg(null); setMsg("Removed");
  };

  return (
    <Card title="GitHub / GitLab PR Write-back" eyebrow="VCS INTEGRATION">
      {loading ? <Spinner /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {cfg && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 8 }}>
              <span style={{ color: C.green, fontSize: 14 }}>✓</span>
              <span style={{ fontSize: 13, color: C.text }}>{cfg.provider === "github" ? "GitHub" : "GitLab"} connected — <code style={{ fontSize: 11 }}>{cfg.owner}/{cfg.repo}</code></span>
              <button onClick={remove} style={{ marginLeft: "auto", background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12 }}>Remove</button>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label className="field-label">Provider</label>
              <select className="inp" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} style={{ marginTop: 6 }}>
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">Personal access token</label>
              <input className="inp inp-mono" type="password" value={form.access_token} onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))} placeholder="ghp_... or glpat-..." style={{ marginTop: 6 }} />
            </div>
            <div className="field">
              <label className="field-label">Owner / org</label>
              <input className="inp" value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))} placeholder="e.g. acme-corp" style={{ marginTop: 6 }} />
            </div>
            <div className="field">
              <label className="field-label">Repository</label>
              <input className="inp" value={form.repo} onChange={(e) => setForm((f) => ({ ...f, repo: e.target.value }))} placeholder="e.g. ai-model" style={{ marginTop: 6 }} />
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
            Verdikt will post commit status checks and PR comments with the verdict after every certification.
            Set <code style={{ fontSize: 11 }}>commit_sha</code> on a release via <code style={{ fontSize: 11 }}>PATCH /api/releases/:id/vcs-context</code> to activate write-back.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={save} disabled={saving || !form.access_token || !form.owner || !form.repo} style={btnStyle(C.accent)}>{saving ? "Saving…" : "Save integration"}</button>
            {msg && <span style={{ fontSize: 13, color: msg === "Saved" || msg === "Removed" ? C.green : C.red }}>{msg}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
