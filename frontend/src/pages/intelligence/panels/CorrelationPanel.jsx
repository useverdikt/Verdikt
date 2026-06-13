import React, { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../lib/apiClient.js";
import { C } from "../theme.js";
import { btnStyle } from "../styles.js";
import { Badge, Card, Spinner, EmptyState, ErrorState } from "../ui.jsx";
import { panelErrorMessage } from "../panelLoad.js";

export function CorrelationPanel({ wsId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [trends, setTrends] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [corrR, ftR] = await Promise.allSettled([
        apiGet(`/api/workspaces/${wsId}/correlations`),
        apiGet(`/api/workspaces/${wsId}/failure-mode-trends`)
      ]);
      if (corrR.status === "fulfilled") setData(corrR.value);
      else setData(null);
      if (ftR.status === "fulfilled") setTrends(ftR.value);
      else setTrends(null);
      if (corrR.status === "rejected") {
        throw corrR.reason;
      }
      if (ftR.status === "rejected") {
        setError(panelErrorMessage(ftR.reason, "Could not load failure mode trends."));
      }
    } catch (err) {
      setError(panelErrorMessage(err, "Could not load correlation data."));
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  const compute = async () => {
    setComputing(true);
    try {
      await apiPost(`/api/workspaces/${wsId}/correlations/compute`, { window_n: 20 });
      await load();
    } finally { setComputing(false); }
  };

  useEffect(() => { load(); }, [load]);

  const corrColor = (r) => r >= 0.7 ? C.green : r >= 0.4 ? C.amber : r <= -0.4 ? C.red : C.dim;

  return (
    <Card title="Signal Correlations & Failure Modes" eyebrow="PATTERN INTELLIGENCE"
      action={<button onClick={compute} disabled={computing} style={btnStyle(C.cyan)}>{computing ? "Computing…" : "Recompute"}</button>}>
      {loading && !data && !error ? <Spinner /> : error && !data ? (
        <ErrorState msg={error} onRetry={load} />
      ) : (
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
