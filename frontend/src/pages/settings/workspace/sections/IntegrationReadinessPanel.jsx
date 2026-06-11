import React, { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../../settingsClient.js";

export default function IntegrationReadinessPanel({ wsId, navigate, toast }) {
  const [checklist, setChecklist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [probeSha, setProbeSha] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState(null);

  const load = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    try {
      const out = await apiGet(`/api/workspaces/${wsId}/integration-readiness`, { navigate });
      setChecklist(out);
    } catch (e) {
      toast(e?.message || "Could not load integration readiness");
    } finally {
      setLoading(false);
    }
  }, [wsId, navigate, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runProbe() {
    const sha = probeSha.trim();
    if (sha.length < 7) {
      toast("Enter a PR head commit SHA (7+ characters)");
      return;
    }
    setProbing(true);
    setProbeResult(null);
    try {
      const out = await apiPost(`/api/workspaces/${wsId}/integration-readiness/probe`, { commit_sha: sha }, { navigate });
      setProbeResult(out);
      if (out.ready) toast("At least one integration matched this SHA");
      else toast("No integrations matched — check SHA tagging in partner CI");
    } catch (e) {
      toast(e?.message || "Probe failed");
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="callout-warn" style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>API pull — not live SDK plugins</div>
      <p className="muted" style={{ margin: "0 0 12px", lineHeight: 1.5 }}>
        Verdikt stores your API keys and <strong>pulls metrics from vendor APIs</strong> when you certify a commit
        (label <code>verdikt:rc</code> or agent <code>create_release</code>). Each eval/build run must be{" "}
        <strong>tagged with the PR head commit SHA</strong> or the cert window stays COLLECTING.
      </p>
      {loading ? (
        <p className="muted">Loading readiness checklist…</p>
      ) : checklist?.integrations?.length ? (
        <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 13, lineHeight: 1.45 }}>
          {checklist.integrations.map((i) => (
            <li key={i.source_id}>
              <strong>{i.label}</strong> — {i.connected ? "Connected" : "Not connected"}
              {i.sha_required ? " · SHA tagging required" : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="field-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="gov-input"
          placeholder="PR head SHA to probe"
          value={probeSha}
          onChange={(e) => setProbeSha(e.target.value)}
          style={{ flex: 1, minWidth: 200, maxWidth: 360 }}
        />
        <button type="button" className="btn-ghost accent" disabled={probing} onClick={() => void runProbe()}>
          {probing ? "Probing…" : "Probe SHA match"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {probeResult ? (
        <pre className="code-block" style={{ marginTop: 12, fontSize: 11, maxHeight: 160, overflow: "auto" }}>
          {JSON.stringify(probeResult.probes || probeResult, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
