import React, { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../../../lib/apiClient.js";
import { api, json } from "../api.js";
import { C, GRADE_COLOR } from "../theme.js";
import { btnStyle, thStyle, tdStyle } from "../styles.js";
import { Badge, Card, Spinner, EmptyState } from "../ui.jsx";

export function SignalReliabilityPanel({ wsId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await json(`/api/workspaces/${wsId}/signal-reliability`)); } catch (_) {}
    finally { setLoading(false); }
  }, [wsId]);

  const compute = async () => {
    setComputing(true);
    try {
      await api(`/api/workspaces/${wsId}/signal-reliability/compute`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ window_n: 20 }) });
      await load();
    } finally { setComputing(false); }
  };

  useEffect(() => { load(); }, [load]);

  return (
    <Card title="Signal Reliability" eyebrow="SOURCE HEALTH"
      action={<button onClick={compute} disabled={computing} style={btnStyle(C.accent)}>{computing ? "Computing…" : "Recompute"}</button>}>
      {loading ? <Spinner /> : !data?.signals?.length ? (
        <EmptyState msg="No reliability data yet — recompute after a few certified releases." />
      ) : (
        <>
          {/* Grade summary */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            {Object.entries(data.summary?.grades || {}).filter(([, c]) => c > 0).map(([grade, count]) => (
              <div key={grade} style={{ background: GRADE_COLOR[grade] + "12", border: `1px solid ${GRADE_COLOR[grade]}30`, borderRadius: 8, padding: "8px 14px", textAlign: "center", minWidth: 60 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: GRADE_COLOR[grade], fontFamily: C.mono }}>{grade}</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{count} signal{count !== 1 ? "s" : ""}</div>
              </div>
            ))}
          </div>
          {/* Signal table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Signal", "Grade", "On-time %", "Stability", "Score"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.signals.map((s) => (
                  <tr key={s.signal_id}>
                    <td style={tdStyle}><code style={{ fontSize: 11 }}>{s.signal_id}</code></td>
                    <td style={tdStyle}><Badge color={GRADE_COLOR[s.grade]}>{s.grade}</Badge></td>
                    <td style={tdStyle}>{Math.round(s.on_time_rate * 100)}%</td>
                    <td style={tdStyle}>
                      <div style={{ width: 60, height: 5, background: C.border, borderRadius: 3 }}>
                        <div style={{ width: `${Math.round((1 - Math.min(1, s.variance_score)) * 100)}%`, height: "100%", background: s.variance_score > 0.5 ? C.red : s.variance_score > 0.25 ? C.amber : C.green, borderRadius: 3 }} />
                      </div>
                    </td>
                    <td style={tdStyle}><span style={{ color: GRADE_COLOR[s.grade], fontFamily: C.mono, fontWeight: 700 }}>{Math.round(s.reliability * 100)}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
