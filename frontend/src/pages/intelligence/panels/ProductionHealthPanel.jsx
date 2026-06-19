import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../../lib/apiClient.js";
import { C } from "../theme.js";
import { btnStyle, thStyle, tdStyle } from "../styles.js";
import { Badge, Card, Spinner, ErrorState, EmptyState } from "../ui.jsx";
import { panelErrorMessage } from "../panelLoad.js";
import {
  ALIGNMENT_LEGEND,
  ALIGNMENT_TABLE_HEADERS,
  formatOutcomeDrivers,
  formatPreShipRecommendation,
  resolveAlignmentDisplay
} from "../alignmentTableCopy.js";

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

const OUTCOME_META = {
  HEALTHY:  { color: "#22c87a", label: "Healthy" },
  DEGRADED: { color: "#f5a623", label: "Degraded" },
  INCIDENT: { color: "#ef4444", label: "Incident" },
  INVESTIGATING: { color: "#a78bfa", label: "Investigating" },
  UNKNOWN:  { color: "#7a788b", label: "Unknown" }
};

function VcsObservationDetail({ signal_deltas = {} }) {
  const rows = [
    ["vcs_reverts", "Revert commits"],
    ["vcs_hotfixes", "Hotfix on main"],
    ["vcs_incident_prs", "Merged incident PRs"],
    ["vcs_investigating_prs", "Open investigating PRs"]
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {rows.map(([key, label]) => (
        <div key={key} style={{ fontSize: 12, color: C.muted }}>
          <strong style={{ color: C.text }}>{label}</strong>
          {": "}
          <code style={{ fontFamily: C.mono }}>{signal_deltas[key]?.post ?? 0}</code>
        </div>
      ))}
      {signal_deltas.vcs_healthy?.post != null ? (
        <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
          VCS monitoring window closed with no degradation signals.
        </div>
      ) : null}
    </div>
  );
}

export function ProductionHealthPanel({ wsId, prodObservationEnabled, suppressProdObsNotice = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandCriteria, setExpandCriteria] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null); // release_id of expanded alignment row
  const [showManualSignals, setShowManualSignals] = useState(false);

  const load = useCallback(async () => {
    if (!prodObservationEnabled) return;
    setLoading(true);
    setError(null);
    let active = true;
    try {
      const result = await apiGet(`/api/workspaces/${wsId}/production-health`);
      if (active) setData(result);
    } catch (err) {
      if (active) { setData(null); setError(panelErrorMessage(err, "Could not load production health data.")); }
    } finally {
      if (active) setLoading(false);
    }
    return () => { active = false; };
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
        {suppressProdObsNotice ? (
          <EmptyState msg="Alignment data requires production observation — see the notice above." />
        ) : (
          <>
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
          </>
        )}
      </Card>
    );
  }

  const total = data?.total_releases_with_feedback ?? 0;
  const acc = data?.prediction_accuracy_pct;
  const accColor = acc == null ? C.dim : acc >= 80 ? C.green : acc >= 60 ? C.amber : C.red;
  const mod = data?.production_confidence_modifier;
  const modColor = mod == null ? C.dim : mod >= 0 ? C.green : mod >= -8 ? C.amber : C.red;
  const pendingCal = data?.pending_calibration_suggestions ?? 0;

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
      <div style={{ marginBottom: 14, fontSize: 12 }}>
        <Link
          to="/intelligence/vcs"
          style={{ fontFamily: C.mono, fontWeight: 600, color: C.accentL, textDecoration: "none" }}
        >
          View VCS production monitor →
        </Link>
      </div>
      {loading && !data ? <Spinner /> : error ? (
        <ErrorState msg={error} onRetry={load} />
      ) : total === 0 ? (
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
              → Check the{" "}
              <Link to="/intelligence/vcs" style={{ color: C.accentL, fontWeight: 600, textDecoration: "none" }}>
                VCS Production Monitor
              </Link>{" "}
              for active windows.
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

          {/* Prod calibration suggestions live on Thresholds — apply/dismiss there */}
          {pendingCal > 0 && (
            <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: C.amberDim, border: `1px solid ${C.amber}35` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, marginBottom: 6 }}>
                {pendingCal} threshold suggestion{pendingCal === 1 ? "" : "s"} from production alignment
              </div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
                MISS and over-block patterns are converted into actionable threshold changes. Review and apply on the Thresholds page — suggest-only, no automatic changes.
              </div>
              <Link
                to="/thresholds"
                style={{
                  fontFamily: C.mono,
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.amber,
                  textDecoration: "none",
                  letterSpacing: "0.04em"
                }}
              >
                Open Threshold suggestions →
              </Link>
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
                    {ALIGNMENT_TABLE_HEADERS.map((h) => (
                      <th key={h.key} style={thStyle} title={h.title}>
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.alignments.map((a) => {
                    const alignmentDisplay = resolveAlignmentDisplay(a.alignment, a);
                    const om = OUTCOME_META[a.actual_outcome] || OUTCOME_META.UNKNOWN;
                    const drivers = formatOutcomeDrivers(a);
                    const preShip = formatPreShipRecommendation(a.recommended_verdict, a);
                    const isExpanded = expandedRow === a.release_id;
                    const recColor = preShip.color === "red" ? C.red : preShip.color === "amber" ? C.amber : preShip.color === "green" ? C.green : C.dim;
                    return (
                      <React.Fragment key={a.release_id}>
                        <tr
                          onClick={() => drivers.expandable && setExpandedRow(isExpanded ? null : a.release_id)}
                          style={{
                            cursor: drivers.expandable ? "pointer" : "default",
                            background: isExpanded ? "rgba(255,255,255,0.03)" : "transparent"
                          }}
                        >
                          <td style={tdStyle}>
                            <code style={{ fontSize: 11, fontFamily: C.mono }}>{a.version || a.release_id?.slice(0, 8) || "—"}</code>
                            {drivers.expandable && (
                              <span style={{ fontSize: 9, color: C.dim, marginLeft: 5 }}>{isExpanded ? "▲" : "▼"}</span>
                            )}
                          </td>
                          <td style={tdStyle} title={preShip.title}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <Badge color={recColor}>{preShip.label}</Badge>
                              {preShip.riskIndicator ? (
                                <span style={{ fontSize: 10, color: C.amber, lineHeight: 1 }} title="Elevated risk flags" aria-label="Elevated risk">
                                  ⚠
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td style={tdStyle}>
                            <span style={{ color: om.color, fontFamily: C.mono, fontWeight: 700, fontSize: 12 }} title={om.label}>
                              {a.actual_outcome}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, maxWidth: 260 }}>
                            <span style={{ fontSize: 11, color: C.muted }}>{drivers.text}</span>
                          </td>
                          <td style={tdStyle} title={alignmentDisplay.title || ALIGNMENT_LEGEND}>
                            <Badge color={alignmentDisplay.color}>
                              {alignmentDisplay.icon} {alignmentDisplay.label}
                            </Badge>
                          </td>
                          <td style={tdStyle}>
                            <span style={{ fontSize: 11, color: a.incident_ref ? C.accent : C.dim, fontFamily: C.mono }}>
                              {a.incident_ref || "—"}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} style={{ ...tdStyle, background: "rgba(255,255,255,0.02)", paddingTop: 10, paddingBottom: 10 }}>
                              <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, letterSpacing: "0.08em", marginBottom: 6, fontWeight: 700 }}>
                                OUTCOME DRIVERS
                              </div>
                              {drivers.detailKind === "criteria" ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                  {a.outcome_criteria.map((c, i) => (
                                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
                                      <span style={{ color: c.outcome === "INCIDENT" ? C.red : C.amber, fontWeight: 700, flexShrink: 0 }}>
                                        {c.outcome === "INCIDENT" ? "✗" : "⚠"}
                                      </span>
                                      <span>
                                        <strong style={{ color: C.text }}>{c.signal}</strong> ={" "}
                                        <code style={{ fontFamily: C.mono }}>{typeof c.value === "number" ? c.value.toFixed(2) : c.value}</code>
                                      </span>
                                      <span style={{ color: C.dim }}>— {c.label} (threshold: {c.threshold})</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <VcsObservationDetail signal_deltas={a.signal_deltas} />
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              <p style={{ margin: "12px 0 0", fontSize: 11, color: C.dim, lineHeight: 1.55 }}>{ALIGNMENT_LEGEND}</p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}