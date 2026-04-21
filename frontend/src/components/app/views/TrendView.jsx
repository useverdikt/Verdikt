import React from "react";
import { C } from "../../../theme/tokens.js";

export default function TrendView({
  releases,
  signalCategories,
  thresholds,
  trendChartMaxPoints,
  getRegressionRequired,
  evaluateSignal,
  calcCategoryStatus,
  catStatusColor,
  trendChartXLabel,
  formatReleaseDisplayName
}) {
  const historyFull = [...releases].reverse();
  const chartHistory = historyFull.slice(-trendChartMaxPoints);
  const W = 580, H = 160, PL = 38, PB = 26, iW = W - PL - 14, iH = H - PB - 10;
  const passRate = (r) => {
    const all = signalCategories.flatMap((c) => c.signals).map((sig) => {
      const val = r.signals[sig.id];
      const reqd = getRegressionRequired(r.releaseType);
      if (sig.conditional && (val === null || val === void 0 || reqd === false)) return null;
      if (val === void 0 || val === null) return null;
      return evaluateSignal(sig, val, thresholds[sig.id]).pass;
    }).filter((x) => x !== null);
    return all.length ? Math.round(all.filter(Boolean).length / all.length * 100) : 0;
  };
  const pts = chartHistory.map((r, i) => ({
    x: PL + i / Math.max(chartHistory.length - 1, 1) * iW,
    y: 10 + (100 - passRate(r)) / 100 * iH,
    r,
    rate: passRate(r)
  }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontFamily: C.mono, fontSize: 10, letterSpacing: "0.11em", textTransform: "uppercase", color: C.dim, marginBottom: 6 }}>Analytics</div>
        <h2 style={{ margin: 0, fontFamily: C.serif, fontSize: 28, fontWeight: 600, color: C.text, letterSpacing: "-0.01em", lineHeight: 1.1 }}>Signal Trend</h2>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 22 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 16, letterSpacing: "0.1em", fontFamily: C.mono }}>
          SIGNAL PASS RATE — RELEASE HISTORY
        </div>
        {historyFull.length < 2 ? (
          <div style={{ textAlign: "center", padding: "30px", color: C.muted }}>Add more releases to see the trend.</div>
        ) : (
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
            {[70, 80, 90, 100].map((v) => {
              const y = 10 + (100 - v) / 100 * iH;
              return (
                <g key={v}>
                  <line x1={PL} y1={y} x2={W - 14} y2={y} stroke={C.border} strokeWidth={1} />
                  <text x={PL - 8} y={y + 4} fill={C.dim} fontSize={9} textAnchor="end" fontFamily={C.mono}>{v}%</text>
                </g>
              );
            })}
            <path d={`${path} L ${pts[pts.length - 1].x} ${10 + iH} L ${pts[0].x} ${10 + iH} Z`} fill={C.accent} opacity={0.05} />
            <path d={path} fill="none" stroke={C.accent} strokeWidth={1.5} strokeLinejoin="round" opacity={0.8} />
            {pts.map((p, i) => {
              const dc = p.r.status === "overridden" ? C.amber : p.r.status === "blocked" ? C.red : C.green;
              return (
                <g key={i}>
                  <title>{p.r.version}</title>
                  <circle cx={p.x} cy={p.y} r={4.5} fill={dc} stroke={C.surface} strokeWidth={2} />
                  {(() => {
                    const lx = trendChartXLabel(i, pts.length);
                    return lx ? (
                      <text x={p.x} y={H - 6} fill={C.dim} fontSize={9} textAnchor="middle" fontFamily={C.mono} fontWeight={600}>{lx}</text>
                    ) : null;
                  })()}
                </g>
              );
            })}
          </svg>
        )}
        <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, marginTop: 8 }}>
          X-axis: release index in this window (R1 = oldest shown). Hover a point for the full release id.
        </div>
        {historyFull.length > trendChartMaxPoints && (
          <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, marginTop: 10 }}>
            Showing latest {trendChartMaxPoints} of {historyFull.length} releases (newest on the right).
          </div>
        )}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: "0.1em", fontFamily: C.mono, textTransform: "uppercase" }}>
            CATEGORY PASS/FAIL (columns match chart: R1–R{chartHistory.length})
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <td style={{ padding: "10px 16px", fontSize: 9.5, color: C.dim, fontFamily: C.mono, fontWeight: 700, minWidth: 160, letterSpacing: "0.09em" }}>CATEGORY</td>
                  {chartHistory.map((r, ri) => (
                    <td key={r.id} style={{ padding: "10px 8px", fontSize: 9.5, color: C.dim, fontFamily: C.mono, textAlign: "center", whiteSpace: "nowrap", fontWeight: 700, letterSpacing: "0.09em" }} title={r.version}>
                      R{ri + 1}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {signalCategories.map((cat) => (
                  <tr key={cat.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 16px", fontSize: 12, color: C.text, fontWeight: 600 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: cat.color }}>{cat.icon}</span>{cat.label}
                      </div>
                    </td>
                    {chartHistory.map((r) => {
                      const status = calcCategoryStatus(cat.id, r.signals, thresholds, r.releaseType);
                      const sc = catStatusColor(status);
                      return (
                        <td key={r.id} style={{ padding: "8px 12px", textAlign: "center" }}>
                          <div style={{ width: 36, height: 22, borderRadius: 5, background: `${sc}20`, border: `1px solid ${sc}40`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
                            <span style={{ fontSize: 10, fontFamily: C.mono, fontWeight: 700, color: sc }}>
                              {status === "pass" ? "✓" : status === "waived" ? "~" : "✗"}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {(() => {
          if (pts.length < 2) return null;
          const avg = Math.round(pts.reduce((a, p) => a + p.rate, 0) / pts.length);
          const insights = [];
          const drops = pts.filter((p) => p.rate < avg - 15);
          if (drops.length > 0) insights.push({ color: C.amber, icon: "⚠", text: `${formatReleaseDisplayName(drops[0].r.version)} had a pass rate of ${drops[0].rate}% — ${avg - drops[0].rate} points below your ${avg}% average. Review which signals failed that release.` });
          const overriddenReleases = releases.filter((r) => r.status === "overridden");
          if (overriddenReleases.length >= 2) insights.push({ color: C.accent, icon: "◈", text: `${overriddenReleases.length} releases shipped via override. If overrides cluster in the same signal category, your thresholds may need recalibration.` });
          const last3 = pts.slice(-3);
          if (last3.length === 3) {
            const trend = last3[2].rate - last3[0].rate;
            if (trend >= 10) insights.push({ color: C.green, icon: "↑", text: `Pass rate has improved ${trend} points across your last 3 releases. Quality trajectory is positive.` });
            if (trend <= -10) insights.push({ color: C.red, icon: "↓", text: `Pass rate has declined ${Math.abs(trend)} points across your last 3 releases. Investigate recurring failures before the next release.` });
          }
          if (insights.length === 0) insights.push({ color: C.green, icon: "✓", text: `No anomalies detected across ${releases.length} releases. Signal quality is consistent with your defined thresholds.` });
          return (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.1em", fontFamily: C.mono }}>AI INSIGHTS</div>
                <div style={{ fontSize: 9, color: C.accentBright, fontFamily: C.mono, background: `${C.accent}15`, padding: "2px 7px", borderRadius: 4, fontWeight: 700, letterSpacing: "0.08em" }}>POWERED BY VERDIKT</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {insights.map((ins, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "13px 18px", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
                    <div style={{ fontSize: 14, color: ins.color, flexShrink: 0, marginTop: 1 }}>{ins.icon}</div>
                    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.65 }}>{ins.text}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
