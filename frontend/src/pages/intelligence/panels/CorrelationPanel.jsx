import React, { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../../lib/apiClient.js";
import { api, json } from "../api.js";
import { C } from "../theme.js";
import { btnStyle } from "../styles.js";
import { Badge, Card, Spinner, EmptyState } from "../ui.jsx";

export function CorrelationPanel({ wsId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [trends, setTrends] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [corr, ft] = await Promise.all([
        json(`/api/workspaces/${wsId}/correlations`),
        json(`/api/workspaces/${wsId}/failure-mode-trends`)
      ]);
      setData(corr);
      setTrends(ft);
    } catch (_) {}
    finally { setLoading(false); }
  }, [wsId]);

  const compute = async () => {
    setComputing(true);
    try {
      await api(`/api/workspaces/${wsId}/correlations/compute`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ window_n: 20 }) });
      await load();
    } finally { setComputing(false); }
  };

  useEffect(() => { load(); }, [load]);

  const corrColor = (r) => r >= 0.7 ? C.green : r >= 0.4 ? C.amber : r <= -0.4 ? C.red : C.dim;

  return (
    <Card title="Signal Correlations & Failure Modes" eyebrow="PATTERN INTELLIGENCE"
      action={<button onClick={compute} disabled={computing} style={btnStyle(C.cyan)}>{computing ? "Computing…" : "Recompute"}</button>}>
      {loading ? <Spinner /> : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Correlations */}
          <div>
            <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, letterSpacing: "0.06em", marginBottom: 10 }}>TOP CORRELATIONS</div>
            {!data?.correlations?.length ? <EmptyState msg="No correlations yet" /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.correlations.slice(0, 8).map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: C.raise, borderRadius: 7, border: `1px solid ${C.border}` }}>
                    <code style={{ fontSize: 11, color: C.mid, flex: 1 }}>{c.signal_a} ↔ {c.signal_b}</code>
                    <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: corrColor(c.correlation) }}>
                      {c.correlation > 0 ? "+" : ""}{c.correlation.toFixed(2)}
                    </span>
                    <span style={{ fontSize: 10, color: C.dim }}>n={c.sample_count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Failure mode trends */}
          <div>
            <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, letterSpacing: "0.06em", marginBottom: 10 }}>FAILURE MODE TRENDS</div>
            {!trends?.trends?.length ? <EmptyState msg="No failure modes classified yet" /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {trends.trends.map((t, i) => (
                  <div key={i} style={{ padding: "8px 12px", background: C.raise, borderRadius: 7, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{t.label}</span>
                      <Badge color={t.count >= 5 ? C.red : t.count >= 2 ? C.amber : C.dim}>{t.count}×</Badge>
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>{t.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
