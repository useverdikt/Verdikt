import React, { useMemo, useState } from "react";
import { apiPost } from "../../../lib/apiClient.js";
import { C } from "../theme.js";
import { btnStyle, thStyle, tdStyle } from "../styles.js";
import { Badge, Card } from "../ui.jsx";

function formatProposedSignals(proposed) {
  if (!proposed || typeof proposed !== "object") return [];
  return Object.entries(proposed).map(([signalId, rule]) => {
    if (rule?.min != null) return `${signalId} ≥ ${rule.min}`;
    if (rule?.max != null) return `${signalId} ≤ ${rule.max}`;
    return signalId;
  });
}

function resultBanner(summary) {
  if (!summary) return null;
  const { total, would_flip, certified_to_uncertified, uncertified_to_certified } = summary;

  if (total === 0) {
    return {
      tone: "amber",
      title: "No releases to simulate",
      body: "Need at least one release in CERTIFIED or UNCERTIFIED status with ingested signals. Finish a certification window or ingest via signal-sim first."
    };
  }
  if (would_flip === 0) {
    return {
      tone: "green",
      title: "Simulation complete — no verdict changes",
      body: `Checked ${total} release${total === 1 ? "" : "s"}. These proposed thresholds would not flip any historical verdicts (absolute min/max on ingested signals only). Try a larger change to explore impact.`
    };
  }
  if (certified_to_uncertified > 0 && uncertified_to_certified === 0) {
    return {
      tone: "red",
      title: `${would_flip} release${would_flip === 1 ? "" : "s"} would become UNCERTIFIED`,
      body: "Stricter thresholds would block certification on past releases that currently pass."
    };
  }
  if (uncertified_to_certified > 0 && certified_to_uncertified === 0) {
    return {
      tone: "green",
      title: `${would_flip} release${would_flip === 1 ? "" : "s"} would become CERTIFIED`,
      body: "Looser thresholds would certify past releases that currently fail on absolute thresholds."
    };
  }
  return {
    tone: "amber",
    title: `${would_flip} release${would_flip === 1 ? "" : "s"} would change verdict`,
    body: `${certified_to_uncertified} certified → uncertified · ${uncertified_to_certified} uncertified → certified`
  };
}

function bannerColors(tone) {
  if (tone === "green") return { border: C.green + "40", bg: C.green + "12", title: C.green, icon: "✓" };
  if (tone === "red") return { border: C.red + "40", bg: C.red + "12", title: C.red, icon: "!" };
  return { border: C.amber + "40", bg: C.amber + "12", title: C.amber, icon: "i" };
}

export function ThresholdSimulatorPanel({ wsId }) {
  const [rawInput, setRawInput] = useState('{\n  "accuracy": { "min": 87 },\n  "hallucination": { "min": 90 }\n}');
  const [parseError, setParseError] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [result, setResult] = useState(null);

  const runSimulation = async () => {
    setParseError(null);
    let proposed;
    try {
      proposed = JSON.parse(rawInput);
    } catch (e) {
      setParseError(`Invalid JSON: ${e.message}`);
      return;
    }
    if (!proposed || typeof proposed !== "object" || Array.isArray(proposed) || Object.keys(proposed).length === 0) {
      setParseError("JSON must be an object with at least one signal threshold.");
      return;
    }
    setSimulating(true);
    try {
      const data = await apiPost(`/api/workspaces/${wsId}/thresholds/simulate`, {
        proposed_thresholds: proposed,
        limit: 50
      });
      setResult(data);
    } catch (e) {
      setResult({ error: e?.message || "Simulation failed — check network and try again." });
    } finally {
      setSimulating(false);
    }
  };

  const summary = result?.summary;
  const banner = useMemo(() => (summary ? resultBanner(summary) : null), [summary]);
  const flipColor = !summary ? C.dim : summary.flip_rate_pct === 0 ? C.green : summary.flip_rate_pct < 25 ? C.amber : C.red;
  const flips = result?.releases?.filter((r) => r.would_flip) ?? [];
  const unchanged = summary ? summary.total - summary.would_flip : 0;
  const proposedLabels = formatProposedSignals(result?.proposed_thresholds);

  return (
    <Card title="Threshold Simulator" eyebrow="WHAT-IF ANALYSIS">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
            Enter proposed thresholds as JSON. Only specify signals you want to change — others stay as-is. Re-runs absolute min/max checks on up to 50 recent certified or uncertified releases.
          </div>
          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            spellCheck={false}
            rows={8}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: C.bg,
              color: C.text,
              border: `1px solid ${parseError ? C.red : C.border}`,
              borderRadius: 8,
              padding: "10px 12px",
              fontFamily: C.mono,
              fontSize: 12,
              lineHeight: 1.6,
              resize: "vertical",
              outline: "none"
            }}
          />
          {parseError && (
            <div style={{ fontSize: 11, color: C.red, fontFamily: C.mono, marginTop: 4 }}>{parseError}</div>
          )}
          <button
            type="button"
            onClick={runSimulation}
            disabled={simulating || !wsId}
            style={{ ...btnStyle(C.accent), marginTop: 10, width: "100%", opacity: simulating || !wsId ? 0.7 : 1 }}
          >
            {simulating ? "⟳ Simulating…" : "▶ Run simulation"}
          </button>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
            Does not model missing required signals, regression deltas, or overrides — threshold pass/fail on ingested values only.
          </div>
        </div>

        <div>
          {!result ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                minHeight: 180,
                color: C.dim,
                fontSize: 13,
                textAlign: "center",
                gap: 6,
                padding: "0 12px"
              }}
            >
              <span style={{ fontSize: 22, opacity: 0.35 }}>◎</span>
              <span>Run a simulation to see how many historical verdicts would change.</span>
            </div>
          ) : result.error ? (
            <div
              style={{
                background: C.red + "12",
                border: `1px solid ${C.red}40`,
                borderRadius: 8,
                padding: "14px 16px",
                color: C.red,
                fontSize: 13,
                lineHeight: 1.55
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Simulation failed</div>
              {result.error}
            </div>
          ) : (
            <>
              {banner && (() => {
                const bc = bannerColors(banner.tone);
                return (
                  <div
                    style={{
                      background: bc.bg,
                      border: `1px solid ${bc.border}`,
                      borderRadius: 8,
                      padding: "12px 14px",
                      marginBottom: 14
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ fontFamily: C.mono, fontSize: 11, fontWeight: 800, color: bc.title, marginTop: 1 }}>{bc.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>{banner.title}</div>
                        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{banner.body}</div>
                        {proposedLabels.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                            {proposedLabels.map((label) => (
                              <span
                                key={label}
                                style={{
                                  fontFamily: C.mono,
                                  fontSize: 10,
                                  color: C.accent,
                                  background: C.accent + "12",
                                  border: `1px solid ${C.accent}30`,
                                  borderRadius: 4,
                                  padding: "2px 7px"
                                }}
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                {[
                  { label: "Releases checked", value: summary.total, color: C.text },
                  { label: "Would flip verdict", value: summary.would_flip, color: flipColor },
                  { label: "Unchanged verdict", value: unchanged, color: C.muted },
                  { label: "Flip rate", value: `${summary.flip_rate_pct}%`, color: flipColor }
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: C.raise, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: C.mono }}>{value}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 3, lineHeight: 1.4 }}>{label}</div>
                  </div>
                ))}
              </div>

              {(summary.certified_to_uncertified > 0 || summary.uncertified_to_certified > 0) && (
                <div style={{ display: "flex", gap: 12, marginBottom: 14, fontSize: 11, fontFamily: C.mono, color: C.dim }}>
                  {summary.certified_to_uncertified > 0 && (
                    <span style={{ color: C.red }}>↓ {summary.certified_to_uncertified} certified → uncertified</span>
                  )}
                  {summary.uncertified_to_certified > 0 && (
                    <span style={{ color: C.green }}>↑ {summary.uncertified_to_certified} uncertified → certified</span>
                  )}
                </div>
              )}

              <div style={{ marginBottom: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, marginBottom: 5 }}>
                  <span>Impact on checked releases</span>
                  <span style={{ color: flipColor, fontWeight: 700 }}>{summary.flip_rate_pct}% would flip</span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: C.border, display: "flex", overflow: "hidden" }}>
                  {summary.total > 0 && (
                    <>
                      <div
                        style={{
                          height: "100%",
                          width: `${100 - summary.flip_rate_pct}%`,
                          background: C.green + "80",
                          transition: "width 0.4s"
                        }}
                      />
                      <div
                        style={{
                          height: "100%",
                          width: `${summary.flip_rate_pct}%`,
                          background: flipColor,
                          transition: "width 0.4s"
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {flips.length > 0 && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, letterSpacing: "0.1em", marginBottom: 10, fontWeight: 700 }}>
            RELEASES THAT WOULD FLIP ({flips.length})
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Release", "Current verdict", "Simulated verdict", "Why"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flips.map((r) => (
                  <tr key={r.release_id}>
                    <td style={tdStyle}>
                      <code style={{ fontFamily: C.mono, fontSize: 11 }}>{r.version || r.release_id.slice(0, 8)}</code>
                    </td>
                    <td style={tdStyle}>
                      <Badge color={r.original_verdict === "CERTIFIED" ? C.green : C.red}>{r.original_verdict}</Badge>
                    </td>
                    <td style={tdStyle}>
                      <Badge color={r.simulated_verdict === "CERTIFIED" ? C.green : C.red}>{r.simulated_verdict}</Badge>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {(r.flip_reasons || []).slice(0, 3).map((fr, i) => (
                          <span key={i} style={{ fontSize: 11, color: fr.direction === "now_fails" ? C.red : C.green, fontFamily: C.mono }}>
                            {fr.direction === "now_fails" ? "✗" : "✓"} {fr.signal_id}: {typeof fr.value === "number" ? fr.value.toFixed(1) : fr.value}
                          </span>
                        ))}
                        {(r.flip_reasons || []).length === 0 && (
                          <span style={{ fontSize: 11, color: C.dim }}>Threshold change shifted composite outcome</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
