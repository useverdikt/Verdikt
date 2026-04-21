import React, { useState } from "react";
import { authHeaders } from "../../../lib/apiClient.js";
import { api } from "../api.js";
import { C } from "../theme.js";
import { btnStyle, thStyle, tdStyle } from "../styles.js";
import { Badge, Card } from "../ui.jsx";

export function ThresholdSimulatorPanel({ wsId }) {
  const [rawInput, setRawInput] = useState('{\n  "accuracy": { "min": 87 },\n  "hallucination": { "min": 90 }\n}');
  const [parseError, setParseError] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [result, setResult] = useState(null);

  const runSimulation = async () => {
    setParseError(null);
    let proposed;
    try { proposed = JSON.parse(rawInput); } catch (e) {
      setParseError(`Invalid JSON: ${e.message}`);
      return;
    }
    setSimulating(true);
    try {
      const res = await api(`/api/workspaces/${wsId}/thresholds/simulate`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ proposed_thresholds: proposed, limit: 50 })
      });
      setResult(await res.json());
    } catch (_) {
      setResult({ error: "Simulation failed — check backend." });
    } finally { setSimulating(false); }
  };

  const summary = result?.summary;
  const flipColor = !summary ? C.dim : summary.flip_rate_pct === 0 ? C.green : summary.flip_rate_pct < 25 ? C.amber : C.red;
  const flips = result?.releases?.filter(r => r.would_flip) ?? [];

  return (
    <Card title="Threshold Simulator" eyebrow="WHAT-IF ANALYSIS">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Input editor */}
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
            Enter proposed thresholds as JSON. Only specify the signals you want to change — others stay as-is.
          </div>
          <textarea
            value={rawInput}
            onChange={e => setRawInput(e.target.value)}
            spellCheck={false}
            rows={8}
            style={{
              width: "100%", boxSizing: "border-box",
              background: C.bg, color: C.text, border: `1px solid ${parseError ? C.red : C.border}`,
              borderRadius: 8, padding: "10px 12px", fontFamily: C.mono, fontSize: 12,
              lineHeight: 1.6, resize: "vertical", outline: "none"
            }}
          />
          {parseError && (
            <div style={{ fontSize: 11, color: C.red, fontFamily: C.mono, marginTop: 4 }}>{parseError}</div>
          )}
          <button
            onClick={runSimulation}
            disabled={simulating}
            style={{ ...btnStyle(C.accent), marginTop: 10, width: "100%" }}
          >
            {simulating ? "⟳ Simulating…" : "▶ Run simulation"}
          </button>
        </div>

        {/* Results summary */}
        <div>
          {!result ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.dim, fontSize: 13 }}>
              Results appear here
            </div>
          ) : result.error ? (
            <div style={{ color: C.red, fontSize: 13 }}>{result.error}</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                {[
                  { label: "Releases checked", value: summary.total, color: C.text },
                  { label: "Would flip verdict", value: summary.would_flip, color: flipColor },
                  { label: "→ Certified to Uncertified", value: summary.certified_to_uncertified, color: C.red },
                  { label: "→ Uncertified to Certified", value: summary.uncertified_to_certified, color: C.green }
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: C.raise, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: C.mono }}>{value}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 3, lineHeight: 1.4 }}>{label}</div>
                  </div>
                ))}
              </div>
              {/* Flip rate bar */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, marginBottom: 5 }}>
                  <span>Flip rate</span>
                  <span style={{ color: flipColor, fontWeight: 700 }}>{summary.flip_rate_pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: C.border }}>
                  <div style={{ height: "100%", borderRadius: 99, width: `${summary.flip_rate_pct}%`, background: flipColor, transition: "width 0.4s" }} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Flipping releases detail */}
      {flips.length > 0 && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, letterSpacing: "0.1em", marginBottom: 10, fontWeight: 700 }}>
            RELEASES THAT WOULD FLIP ({flips.length})
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Release", "Current verdict", "Simulated verdict", "Why"].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flips.map((r) => (
                  <tr key={r.release_id}>
                    <td style={tdStyle}><code style={{ fontFamily: C.mono, fontSize: 11 }}>{r.version || r.release_id.slice(0, 8)}</code></td>
                    <td style={tdStyle}><Badge color={r.original_verdict === "CERTIFIED" ? C.green : C.red}>{r.original_verdict}</Badge></td>
                    <td style={tdStyle}><Badge color={r.simulated_verdict === "CERTIFIED" ? C.green : C.red}>{r.simulated_verdict}</Badge></td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {r.flip_reasons.slice(0, 3).map((fr, i) => (
                          <span key={i} style={{ fontSize: 11, color: fr.direction === "now_fails" ? C.red : C.green, fontFamily: C.mono }}>
                            {fr.direction === "now_fails" ? "✗" : "✓"} {fr.signal_id}: {typeof fr.value === "number" ? fr.value.toFixed(1) : fr.value}
                          </span>
                        ))}
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