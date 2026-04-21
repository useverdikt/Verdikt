import React, { useCallback, useEffect, useState } from "react";
import { json } from "../api.js";
import { C } from "../theme.js";
import { btnStyle, thStyle, tdStyle } from "../styles.js";
import { Card, Spinner, EmptyState } from "../ui.jsx";

const WINDOW_STATUS_META = {
  pending:   { color: "#7a788b", label: "Pending first scan",   icon: "⏳" },
  scanning:  { color: "#f5a623", label: "Actively monitoring",  icon: "⊙" },
  complete:  { color: "#22c87a", label: "Window closed",        icon: "✓" },
  no_vcs:    { color: "#7a788b", label: "No VCS integration",   icon: "—" },
  no_sha:    { color: "#7a788b", label: "No commit SHA",        icon: "—" },
  error:     { color: "#ef4444", label: "Scan error",           icon: "✗" }
};
const INFERRED_OUTCOME_META = {
  HEALTHY:  { color: "#22c87a", icon: "✓" },
  DEGRADED: { color: "#f5a623", icon: "⚠" },
  INCIDENT: { color: "#ef4444", icon: "✗" },
  UNKNOWN:  { color: "#7a788b", icon: "?" }
};

export function VcsMonitorPanel({ wsId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await json(`/api/workspaces/${wsId}/vcs-monitor`)); }
    catch (_) {}
    finally { setLoading(false); }
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  const byStatus   = data?.by_status ?? {};
  const byOutcome  = data?.by_outcome ?? {};
  const windows    = data?.windows ?? [];
  const active     = (byStatus.pending ?? 0) + (byStatus.scanning ?? 0);

  return (
    <Card
      title="VCS Production Monitor"
      eyebrow="AUTOMATIC INFERENCE · ZERO USER ACTION"
      action={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {active > 0 && (
            <span style={{ fontSize: 11, color: C.amber, fontFamily: C.mono, letterSpacing: "0.04em" }}>
              ⊙ {active} window{active !== 1 ? "s" : ""} active
            </span>
          )}
          <button onClick={load} disabled={loading} style={btnStyle(C.accent)}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      }
    >
      {/* How it works banner */}
      <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: C.raise, border: `1px solid ${C.border}`, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
        <strong style={{ color: C.text }}>How this works:</strong> After every certified verdict, Verdikt automatically opens a 2-hour monitoring window on your connected GitHub/GitLab repo.
        It scans for <strong style={{ color: C.text }}>revert commits</strong>, <strong style={{ color: C.text }}>hotfix commits</strong>, and <strong style={{ color: C.text }}>incident-labelled PRs</strong>.
        No pipeline changes. No webhooks. Just connect your VCS integration in settings.
      </div>

      {loading ? <Spinner /> : windows.length === 0 ? (
        <EmptyState msg="No monitoring windows yet. Windows open automatically on each new certified verdict." />
      ) : (
        <>
          {/* Summary stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8, marginBottom: 16 }}>
            {[
              { label: "Total monitored", value: data.total, color: C.text },
              { label: "Healthy (no activity)", value: byOutcome.HEALTHY ?? 0, color: C.green },
              { label: "Degraded (hotfix)", value: byOutcome.DEGRADED ?? 0, color: C.amber },
              { label: "Incident (revert / P0)", value: byOutcome.INCIDENT ?? 0, color: C.red },
              { label: "Active windows", value: active, color: C.amber }
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: C.raise, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 4, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1.4 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Per-release window table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Release", "Status", "Inferred outcome", "VCS signals", "Window closes"].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {windows.map((w) => {
                  const sm = WINDOW_STATUS_META[w.status] || WINDOW_STATUS_META.pending;
                  const om = w.inferred_outcome ? (INFERRED_OUTCOME_META[w.inferred_outcome] || INFERRED_OUTCOME_META.UNKNOWN) : null;
                  const sigs = w.inferred_signals || {};
                  const windowEndDate = w.monitoring_end ? new Date(w.monitoring_end) : null;
                  const isPast = windowEndDate && windowEndDate < new Date();
                  return (
                    <tr key={w.release_id}>
                      <td style={tdStyle}>
                        <code style={{ fontSize: 11, fontFamily: C.mono }}>{w.version || w.release_id.slice(0,8)}</code>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: sm.color, fontSize: 12, fontFamily: C.mono }}>
                          {sm.icon} {sm.label}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {om ? (
                          <span style={{ color: om.color, fontWeight: 700, fontSize: 12, fontFamily: C.mono }}>
                            {om.icon} {w.inferred_outcome}
                          </span>
                        ) : (
                          <span style={{ color: C.dim, fontSize: 11 }}>—</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {Object.entries(sigs).filter(([, v]) => typeof v === "number" && v > 0 && !["vcs_healthy"].includes("vcs_healthy")).map(([k, v]) => {
                            const signalColor = k === "vcs_reverts" || k === "vcs_incident_prs" ? C.red : C.amber;
                            return (
                              <span key={k} style={{ fontSize: 10, fontFamily: C.mono, color: signalColor, background: signalColor + "15", border: `1px solid ${signalColor}30`, borderRadius: 4, padding: "1px 6px" }}>
                                {k.replace("vcs_", "")}={v}
                              </span>
                            );
                          })}
                          {sigs.vcs_healthy === 1 && <span style={{ fontSize: 10, color: C.green, fontFamily: C.mono }}>no activity</span>}
                          {Object.keys(sigs).length === 0 && <span style={{ color: C.dim, fontSize: 11 }}>not yet scanned</span>}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 11, color: isPast ? C.dim : C.amber, fontFamily: C.mono }}>
                          {windowEndDate ? windowEndDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                          {isPast ? " (closed)" : ""}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}