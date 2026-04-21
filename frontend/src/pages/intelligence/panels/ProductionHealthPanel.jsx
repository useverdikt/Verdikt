import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { json } from "../api.js";
import { C } from "../theme.js";
import { btnStyle, thStyle, tdStyle } from "../styles.js";
import { Badge, Card, Spinner } from "../ui.jsx";

function OutcomeCriteriaCard({ criteria }) {
  if (!criteria) return null;
  return (
    <div style={{ background: C.raise, border: `1px solid ${C.border}`, borderRadius: 9, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 10 }}>
        Production outcome classification rules
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
        These are the exact thresholds used to classify post-deploy signals as HEALTHY / DEGRADED / INCIDENT.
        <br />The most severe rule that fires wins. Signal names must match exactly.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(criteria).map(([sig, rules]) => (
          <div key={sig} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <code style={{ fontSize: 11, fontFamily: C.mono, color: C.accent, minWidth: 110, flexShrink: 0 }}>{sig}</code>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {rules.map((r, i) => (
                <span key={i} style={{ fontSize: 11, color: r.outcome === "INCIDENT" ? C.red : C.amber }}>
                  {r.outcome}: {r.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const ALIGNMENT_META = {
  CORRECT:    { color: "#22c87a", label: "Correct", icon: "✓" },
  MISS:       { color: "#ef4444", label: "Miss",    icon: "✗" },
  OVER_BLOCK: { color: "#f5a623", label: "Over-block", icon: "⚠" },
  UNKNOWN:    { color: "#7a788b", label: "Unknown",  icon: "?" }
};
const OUTCOME_META = {
  HEALTHY:  { color: "#22c87a" },
  DEGRADED: { color: "#f5a623" },
  INCIDENT: { color: "#ef4444" },
  UNKNOWN:  { color: "#7a788b" }
};

export function ProductionHealthPanel({ wsId, prodObservationEnabled }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandCriteria, setExpandCriteria] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null); // release_id of expanded alignment row
  const [showManualSignals, setShowManualSignals] = useState(false);

  const load = useCallback(async () => {
    if (!prodObservationEnabled) return;
    setLoading(true);
    try { setData(await json(`/api/workspaces/${wsId}/production-health`)); }
    catch (_) {}
    finally { setLoading(false); }
  }, [wsId, prodObservationEnabled]);

  useEffect(() => {
    if (prodObservationEnabled) load();
  }, [load, prodObservationEnabled]);

  if (!prodObservationEnabled) {
    return (
      <Card
        title="Production Alignment"
        eyebrow="PREDICTION vs REALITY · POWERED BY VCS INFERENCE + OPTIONAL METRICS"
      >
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, marginBottom: 12 }}>
          Production alignment and post-deploy feedback require <strong style={{ color: C.text }}>Production observation</strong>{" "}
          to be enabled. Turn it on under Workspace → General to let Verdikt gather production-side data for this intelligence.
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

  const total = data?.total_releases_with_feedback ?? 0;
  const acc = data?.prediction_accuracy_pct;
  const accColor = acc == null ? C.dim : acc >= 80 ? C.green : acc >= 60 ? C.amber : C.red;
  const mod = data?.production_confidence_modifier;
  const modColor = mod == null ? C.dim : mod >= 0 ? C.green : mod >= -8 ? C.amber : C.red;
  const overBlockSuggestions = data?.over_block_threshold_suggestions ?? [];

  return (
    <Card
      title="Production Alignment"
      eyebrow="PREDICTION vs REALITY · POWERED BY VCS INFERENCE + OPTIONAL METRICS"
      action={
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: C.mono, fontSize: 10, color: C.dim }}>
            {data?.total_observations ?? 0} observations
          </span>
          <button onClick={load} disabled={loading} style={btnStyle(C.accent)}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      }
    >
      {loading ? <Spinner /> : total === 0 ? (
        <div style={{ padding: "4px 0 8px" }}>
          {/* Primary: point to automatic VCS inference */}
          <div style={{ padding: "14px 16px", borderRadius: 10, background: C.raise, border: `1px solid ${C.border}`, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>Waiting for first alignment</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
              Production data is collected <strong style={{ color: C.text }}>automatically</strong> once a VCS integration is connected —
              Verdikt monitors your GitHub/GitLab repo for reverts, hotfixes, and incident PRs after each certified release.
              No pipeline changes needed.
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: C.dim }}>
              → Check the <strong style={{ color: C.accent }}>VCS Production Monitor</strong> panel above to see active windows.
            </div>
          </div>

          <div style={{ marginTop: 4 }}>
            <button
              onClick={() => setExpandCriteria(v => !v)}
              style={{ ...btnStyle(C.dim), marginBottom: 10, fontSize: 11 }}
            >
              {expandCriteria ? "▲ Hide" : "▼ Show"} outcome classification criteria
            </button>
            {expandCriteria && <OutcomeCriteriaCard criteria={data?.outcome_classification_criteria} />}
          </div>

          {/* Advanced: manual metric signals */}
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setShowManualSignals(v => !v)}
              style={{ ...btnStyle(C.dim), fontSize: 11 }}
            >
              {showManualSignals ? "▲ Hide" : "▼ Show"} advanced: send metric signals manually
            </button>
            {showManualSignals && (
              <div style={{ marginTop: 10, background: C.raise, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
                  For metric-level granularity (error rate, latency, accuracy scores), POST directly from your pipeline or observability tool:
                </div>
                <pre style={{ margin: 0, fontSize: 11, color: C.dim, background: C.bg, borderRadius: 7, padding: "10px 12px", overflowX: "auto", fontFamily: C.mono }}>
{`POST /api/releases/:releaseId/production-signals
X-Idempotency-Key: deploy-<build-id>
Content-Type: application/json

{
  "signals": {
    "accuracy": 91.2,
    "hallucination": 93.0,
    "p95latency": 310
  },
  "source": "datadog"
}`}
                </pre>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* ── Accuracy summary stats ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Prediction accuracy", value: acc != null ? `${acc}%` : "—", color: accColor },
              { label: "Correct predictions", value: data.correct, color: C.green },
              { label: "Misses (certified → incident)", value: data.misses, color: C.red },
              { label: "Over-blocks (blocked → healthy)", value: data.over_blocks, color: C.amber }
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: C.raise, border: `1px solid ${C.border}`, borderRadius: 9, padding: "12px 14px" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 10, color: C.dim, marginTop: 5, letterSpacing: "0.03em", lineHeight: 1.4 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* ── Fix #2: Production confidence modifier banner ── */}
          {mod != null && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: C.raise, border: `1px solid ${Math.abs(mod) > 5 ? modColor + "40" : C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, color: modColor }}>⊙</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: modColor }}>
                  Recommendation engine adjustment: {mod > 0 ? "+" : ""}{mod} pts confidence
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  Based on {total} past releases. {mod < -5 ? "Repeated misses detected — future recommendations are being held to a higher standard." : mod > 3 ? "Strong track record — confidence boosted for well-aligned predictions." : "Moderate adjustment — continue building alignment history."}
                </div>
              </div>
            </div>
          )}

          {/* ── Fix #3: Over-block threshold suggestions ── */}
          {overBlockSuggestions.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: C.amber, fontFamily: C.mono, letterSpacing: "0.1em", marginBottom: 8, fontWeight: 700 }}>
                ⚠ OVER-BLOCK THRESHOLD SUGGESTIONS ({overBlockSuggestions.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {overBlockSuggestions.map((s) => (
                  <div key={s.signal_id} style={{ background: C.amberDim, border: `1px solid ${C.amber}30`, borderRadius: 8, padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ fontSize: 12, fontFamily: C.mono, color: C.amber, fontWeight: 700 }}>{s.signal_id}</code>
                        <span style={{ fontSize: 11, color: C.dim, fontFamily: C.mono }}>
                          {s.direction === "lower_min" ? `min: ${s.current_threshold} → ${s.suggested_threshold}` : `max: ${s.current_threshold} → ${s.suggested_threshold}`}
                        </span>
                      </div>
                      <Badge color={C.amber}>from {s.version || s.release_id?.slice(0,8)}</Badge>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{s.rationale}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Signal drift ── */}
          {Object.keys(data.avg_signal_drifts || {}).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, letterSpacing: "0.1em", marginBottom: 8, fontWeight: 700 }}>AVG SIGNAL DRIFT (PRE → POST)</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.entries(data.avg_signal_drifts).map(([sig, pct]) => {
                  const driftColor = Math.abs(pct) < 5 ? C.green : Math.abs(pct) < 15 ? C.amber : C.red;
                  return (
                    <div key={sig} style={{ background: C.raise, border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 12px", display: "flex", alignItems: "center", gap: 7 }}>
                      <code style={{ fontSize: 11, color: C.muted, fontFamily: C.mono }}>{sig}</code>
                      <span style={{ fontSize: 12, fontWeight: 700, color: driftColor, fontFamily: C.mono }}>
                        {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Classification criteria + manual signal toggles ── */}
          <div style={{ marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setExpandCriteria(v => !v)} style={{ ...btnStyle(C.dim), fontSize: 11 }}>
              {expandCriteria ? "▲ Hide" : "▼ Show"} outcome classification criteria
            </button>
            <button onClick={() => setShowManualSignals(v => !v)} style={{ ...btnStyle(C.dim), fontSize: 11 }}>
              {showManualSignals ? "▲ Hide" : "▼"} Send metric signals manually
            </button>
          </div>
          {expandCriteria && <div style={{ marginBottom: 14 }}><OutcomeCriteriaCard criteria={data?.outcome_classification_criteria} /></div>}
          {showManualSignals && (
            <div style={{ marginBottom: 14, background: C.raise, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
                Supplement VCS inference with real metric values (error rate, latency, model scores):
              </div>
              <pre style={{ margin: 0, fontSize: 11, color: C.dim, background: C.bg, borderRadius: 7, padding: "10px 12px", overflowX: "auto", fontFamily: C.mono }}>
{`POST /api/releases/:releaseId/production-signals
X-Idempotency-Key: deploy-<build-id>
Content-Type: application/json

{ "signals": { "accuracy": 91.2, "p95latency": 310 }, "source": "datadog" }`}
              </pre>
            </div>
          )}

          {/* ── Per-release alignment table with criteria drill-down ── */}
          {data.alignments?.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Release", "Predicted", "Actual", "Why", "Alignment", "Incident"].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.alignments.map((a) => {
                    const am = ALIGNMENT_META[a.alignment] || ALIGNMENT_META.UNKNOWN;
                    const om = OUTCOME_META[a.actual_outcome] || OUTCOME_META.UNKNOWN;
                    const isExpanded = expandedRow === a.release_id;
                    const hasCriteria = a.outcome_criteria?.length > 0;
                    return (
                      <React.Fragment key={a.release_id}>
                        <tr
                          onClick={() => hasCriteria && setExpandedRow(isExpanded ? null : a.release_id)}
                          style={{ cursor: hasCriteria ? "pointer" : "default", background: isExpanded ? "rgba(255,255,255,0.03)" : "transparent" }}
                        >
                          <td style={tdStyle}>
                            <code style={{ fontSize: 11, fontFamily: C.mono }}>{a.version || a.release_id.slice(0,8)}</code>
                            {hasCriteria && <span style={{ fontSize: 9, color: C.dim, marginLeft: 5 }}>{isExpanded ? "▲" : "▼"}</span>}
                          </td>
                          <td style={tdStyle}>
                            <Badge color={a.recommended_verdict?.includes("UNCERTIFIED") ? C.red : C.green}>
                              {a.recommended_verdict || "—"}
                            </Badge>
                          </td>
                          <td style={tdStyle}>
                            <span style={{ color: om.color, fontFamily: C.mono, fontWeight: 700, fontSize: 12 }}>{a.actual_outcome}</span>
                          </td>
                          <td style={{ ...tdStyle, maxWidth: 220 }}>
                            {/* Fix #1: show first trigger criteria inline */}
                            {a.outcome_criteria?.length > 0 ? (
                              <span style={{ fontSize: 11, color: C.muted }}>{a.outcome_criteria[0].label}: {a.outcome_criteria[0].value?.toFixed?.(1) ?? a.outcome_criteria[0].value}</span>
                            ) : (
                              <span style={{ fontSize: 11, color: C.dim }}>No signals triggered</span>
                            )}
                          </td>
                          <td style={tdStyle}><Badge color={am.color}>{am.icon} {am.label}</Badge></td>
                          <td style={tdStyle}>
                            <span style={{ fontSize: 11, color: a.incident_ref ? C.accent : C.dim, fontFamily: C.mono }}>
                              {a.incident_ref || "—"}
                            </span>
                          </td>
                        </tr>
                        {/* Expanded row: all criteria triggers */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} style={{ ...tdStyle, background: "rgba(255,255,255,0.02)", paddingTop: 10, paddingBottom: 10 }}>
                              <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, letterSpacing: "0.08em", marginBottom: 6, fontWeight: 700 }}>WHY THIS OUTCOME WAS CLASSIFIED</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                {a.outcome_criteria.map((c, i) => (
                                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
                                    <span style={{ color: c.outcome === "INCIDENT" ? C.red : C.amber, fontWeight: 700, flexShrink: 0 }}>
                                      {c.outcome === "INCIDENT" ? "✗" : "⚠"}
                                    </span>
                                    <span><strong style={{ color: C.text }}>{c.signal}</strong> = <code style={{ fontFamily: C.mono }}>{typeof c.value === "number" ? c.value.toFixed(2) : c.value}</code></span>
                                    <span style={{ color: C.dim }}>— {c.label} (threshold: {c.threshold})</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}