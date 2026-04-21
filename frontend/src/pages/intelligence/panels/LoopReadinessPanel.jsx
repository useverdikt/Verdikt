import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { json } from "../api.js";
import { C, BAND_META } from "../theme.js";
import { btnStyle } from "../styles.js";
import { Card, Spinner, EmptyState } from "../ui.jsx";

export function LoopReadinessPanel({ wsId, prodObservationEnabled }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!prodObservationEnabled) return;
    setLoading(true);
    try { setData(await json(`/api/workspaces/${wsId}/loop-readiness`)); }
    catch (_) {}
    finally { setLoading(false); }
  }, [wsId, prodObservationEnabled]);

  useEffect(() => {
    if (prodObservationEnabled) load();
  }, [load, prodObservationEnabled]);

  if (!prodObservationEnabled) {
    return (
      <Card
        title="Feedback Loop Readiness"
        eyebrow="PRE-RELEASE → VERDICT → POST-DEPLOY → ALIGNMENT"
      >
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, marginBottom: 12 }}>
          Post-deploy loop metrics stay off until you enable <strong style={{ color: C.text }}>Production observation</strong>{" "}
          in workspace settings. Pre-release certification is unchanged; this only controls gathering production-side data for the learning loop.
        </div>
        <Link
          to="/settings?section=workspace"
          style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 600, color: C.accentL, textDecoration: "none" }}
        >
          Open Workspace → General
        </Link>
      </Card>
    );
  }

  const band = data?.band ?? "Exploratory";
  const bm = BAND_META[band] || BAND_META.Exploratory;
  const isStale = data?.is_stale;
  const staleColor = "#ef4444";

  return (
    <Card
      title="Feedback Loop Readiness"
      eyebrow="PRE-RELEASE → VERDICT → POST-DEPLOY → ALIGNMENT"
      action={
        <button onClick={load} disabled={loading} style={btnStyle(C.accent)}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      }
    >
      {loading && !data ? <Spinner /> : !data ? (
        <EmptyState msg="Could not load loop readiness data." />
      ) : (
        <>
          {/* Band badge + stale warning */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: isStale ? staleColor + "18" : bm.bg,
              border: `1px solid ${isStale ? staleColor : bm.color}40`,
              borderRadius: 8, padding: "8px 14px"
            }}>
              <span style={{ fontFamily: C.mono, fontSize: 18, fontWeight: 800, color: isStale ? staleColor : bm.color }}>
                {isStale ? "STALE" : band.toUpperCase()}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 2 }}>
                {isStale ? `Loop history exists but last full loop was ${data.last_full_loop_days_ago} days ago` : bm.desc}
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>{data.next_action}</div>
            </div>
          </div>

          {/* Pipeline progress bar */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: C.mono, color: C.dim, letterSpacing: "0.08em", marginBottom: 8, fontWeight: 700 }}>
              PIPELINE FUNNEL
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "Releases created",         value: data.total_releases,                  color: C.muted },
                { label: "Verdicts issued",           value: data.verdict_issued,                   color: C.muted },
                { label: "Eligible for loop",         value: data.eligible_releases,                color: C.muted, note: "verdict > 3h ago" },
                { label: "With production signals",   value: data.with_production_observations,     color: C.amber },
                { label: "With alignment computed",   value: data.with_alignment,                   color: C.green },
              ].map(({ label, value, color, note }) => {
                const pct = data.eligible_releases > 0
                  ? Math.min(100, Math.round((value / data.eligible_releases) * 100))
                  : (value > 0 ? 100 : 0);
                return (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 200, fontSize: 11, color: C.muted, flexShrink: 0, lineHeight: 1.3 }}>
                      {label}
                      {note && <span style={{ fontSize: 9, color: C.dim, marginLeft: 4 }}>({note})</span>}
                    </div>
                    <div style={{ flex: 1, height: 6, background: C.raise, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
                    </div>
                    <div style={{ width: 32, textAlign: "right", fontFamily: C.mono, fontSize: 12, fontWeight: 700, color }}>{value}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Key stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 16 }}>
            {[
              {
                label: "Full loop rate",
                value: `${data.full_loop_rate_pct}%`,
                color: data.full_loop_rate_pct >= 60 ? C.green : data.full_loop_rate_pct >= 30 ? C.amber : C.red,
                note: "of eligible releases"
              },
              {
                label: "Full loops",
                value: data.full_loop_count,
                color: data.full_loop_count >= 50 ? C.green : data.full_loop_count >= 10 ? C.amber : C.muted,
                note: "completed"
              },
              {
                label: "Last full loop",
                value: data.last_full_loop_days_ago !== null ? `${data.last_full_loop_days_ago}d ago` : "Never",
                color: data.last_full_loop_days_ago === null ? C.dim
                  : data.last_full_loop_days_ago > 90 ? staleColor
                  : data.last_full_loop_days_ago > 30 ? C.amber : C.green,
                note: "recency"
              },
              {
                label: "Obs. without align.",
                value: data.observations_without_alignment,
                color: data.observations_without_alignment > 0 ? C.amber : C.green,
                note: "may need retry"
              }
            ].map(({ label, value, color, note }) => (
              <div key={label} style={{ background: C.raise, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 4, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1.4 }}>
                  {label}<br /><span style={{ color: C.dim }}>{note}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Fixed thresholds (for transparency) */}
          <div style={{ padding: "10px 14px", background: C.raise, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, color: C.dim, lineHeight: 1.7 }}>
            <span style={{ fontFamily: C.mono, color: C.muted, fontWeight: 700 }}>Band thresholds (fixed):</span>
            {" "}Exploratory &lt; 10 loops · Emerging 10–50 · Reliable 51+ loops AND ≥60% rate ·
            {" "}<span style={{ color: staleColor }}>Stale</span> if last loop &gt; 90 days ago
          </div>
        </>
      )}
    </Card>
  );
}
