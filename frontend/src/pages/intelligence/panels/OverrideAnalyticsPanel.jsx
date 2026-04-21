import React, { useCallback, useEffect, useState } from "react";
import { json } from "../api.js";
import { C } from "../theme.js";
import { btnStyle } from "../styles.js";
import { Badge, Card, Spinner, EmptyState } from "../ui.jsx";

export function OverrideAnalyticsPanel({ wsId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await json(`/api/workspaces/${wsId}/override-analytics`)); } catch (_) {}
    finally { setLoading(false); }
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  const RISK_COLORS = { STRONG: C.green, ACCEPTABLE: C.amber, WEAK: C.red };

  return (
    <Card title="Override Pattern Analytics" eyebrow="GOVERNANCE INTELLIGENCE"
      action={<button onClick={load} style={btnStyle(C.amber)}>Refresh</button>}>
      {loading ? <Spinner /> : !data ? <EmptyState msg="Could not load analytics." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              { label: "Total overrides", value: data.total_overrides },
              { label: "Override rate", value: `${data.override_rate_pct}%` },
              { label: "Avg days between", value: data.avg_repeat_days != null ? `${data.avg_repeat_days}d` : "—" }
            ].map((k) => (
              <div key={k.label} style={{ background: C.raise, borderRadius: 9, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: C.text, fontFamily: C.mono }}>{k.value}</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>{k.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Top approvers */}
            <div>
              <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, letterSpacing: "0.06em", marginBottom: 10 }}>TOP APPROVERS</div>
              {!data.top_approvers?.length ? <EmptyState msg="No overrides yet" /> : data.top_approvers.map((a, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", marginBottom: 4, background: C.raise, borderRadius: 6, border: `1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize: 12, color: C.text }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: C.dim }}>{a.role || "—"}</div>
                  </div>
                  <Badge color={C.accent}>{a.count}×</Badge>
                </div>
              ))}
            </div>
            {/* Risk distribution */}
            <div>
              <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, letterSpacing: "0.06em", marginBottom: 10 }}>JUSTIFICATION QUALITY</div>
              {Object.entries(data.risk_distribution || {}).map(([grade, count]) => (
                <div key={grade} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: RISK_COLORS[grade], width: 80 }}>{grade}</div>
                  <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3 }}>
                    <div style={{ height: "100%", width: `${data.total_overrides > 0 ? (count / data.total_overrides) * 100 : 0}%`, background: RISK_COLORS[grade], borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 12, color: C.mid, width: 24, textAlign: "right" }}>{count}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Top failing signals at override */}
          {data.top_signals?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, letterSpacing: "0.06em", marginBottom: 10 }}>MOST OVERRIDDEN SIGNALS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {data.top_signals.map((s) => (
                  <div key={s.signal_id} style={{ background: C.raise, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 12, color: C.mid }}>
                    <code style={{ fontSize: 11 }}>{s.signal_id}</code>
                    <span style={{ marginLeft: 6, color: C.red, fontFamily: C.mono, fontWeight: 700 }}>{s.count}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monthly trend */}
          {data.trend?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, letterSpacing: "0.06em", marginBottom: 10 }}>MONTHLY TREND</div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 60 }}>
                {data.trend.map((t) => {
                  const max = Math.max(...data.trend.map((x) => x.count), 1);
                  const h = Math.max(4, (t.count / max) * 52);
                  return (
                    <div key={t.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <div title={`${t.count} override${t.count !== 1 ? "s" : ""}`} style={{ width: "100%", height: h, background: t.count > 0 ? C.amber : C.border, borderRadius: "3px 3px 0 0", opacity: 0.85 }} />
                      <div style={{ fontSize: 9, color: C.dim, fontFamily: C.mono, transform: "rotate(-35deg)", transformOrigin: "top center", whiteSpace: "nowrap" }}>{t.month.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
