import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, getWorkspaceId } from "../lib/apiClient.js";
import { hasBackend } from "../lib/hasBackend.js";

// ─── Signal definitions per source (matches backend integrationTestMock + shared/config.json) ───

const SOURCES = [
  {
    id: "braintrust",
    name: "Braintrust",
    icon: "◐",
    color: "#f97316",
    glow: "rgba(249,115,22,0.18)",
    description: "AI eval scores from Braintrust experiments",
    tag: "AI Evals",
    signals: [
      { id: "accuracy",      label: "Accuracy",      min: 0,   max: 100, step: 1,   unit: "%",   default: 88, threshold: 85 },
      { id: "safety",        label: "Safety",         min: 0,   max: 100, step: 1,   unit: "%",   default: 90, threshold: 90 },
      { id: "tone",          label: "Tone",           min: 0,   max: 100, step: 1,   unit: "%",   default: 86, threshold: 85 },
      { id: "hallucination", label: "Hallucination",  min: 0,   max: 100, step: 1,   unit: "%",   default: 92, threshold: 90 },
      { id: "relevance",     label: "Relevance",      min: 0,   max: 100, step: 1,   unit: "%",   default: 85, threshold: 82 },
    ],
  },
  {
    id: "langsmith",
    name: "LangSmith",
    icon: "⚡",
    color: "#a78bfa",
    glow: "rgba(167,139,250,0.18)",
    description: "LLM eval traces — quality, faithfulness, correctness",
    tag: "LLM Traces",
    signals: [
      { id: "accuracy",      label: "Accuracy",       min: 0,   max: 100, step: 1,   unit: "%",   default: 87, threshold: 85 },
      { id: "safety",        label: "Safety",          min: 0,   max: 100, step: 1,   unit: "%",   default: 91, threshold: 90 },
      { id: "tone",          label: "Tone",            min: 0,   max: 100, step: 1,   unit: "%",   default: 84, threshold: 85 },
      { id: "hallucination", label: "Hallucination",   min: 0,   max: 100, step: 1,   unit: "%",   default: 93, threshold: 90 },
      { id: "relevance",     label: "Relevance",       min: 0,   max: 100, step: 1,   unit: "%",   default: 86, threshold: 82 },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    icon: "◈",
    color: "#f87171",
    glow: "rgba(248,113,113,0.18)",
    description: "Crash rate, error rate, exception volume",
    tag: "Error Tracking",
    signals: [
      { id: "crashrate",  label: "Crash Rate",   min: 0,  max: 5,   step: 0.01, unit: "%",   default: 0.06, threshold: 0.1,  lowerIsBetter: true },
      { id: "errorrate",  label: "Error Rate",   min: 0,  max: 10,  step: 0.01, unit: "%",   default: 0.45, threshold: 1.0,  lowerIsBetter: true },
      { id: "anrrate",    label: "ANR Rate",     min: 0,  max: 2,   step: 0.01, unit: "%",   default: 0.02, threshold: 0.05, lowerIsBetter: true },
    ],
  },
  {
    id: "datadog",
    name: "Datadog",
    icon: "▣",
    color: "#34d399",
    glow: "rgba(52,211,153,0.18)",
    description: "API latency and runtime health metrics",
    tag: "Observability",
    signals: [
      { id: "p95latency", label: "P95 Latency", min: 0, max: 2000, step: 5, unit: "ms", default: 240, threshold: 300, lowerIsBetter: true },
      { id: "p99latency", label: "P99 Latency", min: 0, max: 5000, step: 5, unit: "ms", default: 480, threshold: 600, lowerIsBetter: true },
    ],
  },
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function passesThreshold(sig, value) {
  if (sig.lowerIsBetter) return value <= sig.threshold;
  return value >= sig.threshold;
}

function formatVal(sig, v) {
  if (sig.unit === "%") {
    return sig.step < 1 ? `${Number(v).toFixed(2)}%` : `${Number(v).toFixed(0)}%`;
  }
  if (sig.unit === "ms") return `${Number(v).toFixed(0)}ms`;
  return String(v);
}

function getStatusMeta(status) {
  const map = {
    COLLECTING:             { label: "Collecting",   color: "#f59e0b", dot: "#f59e0b" },
    UNCERTIFIED:            { label: "Uncertified",  color: "#f87171", dot: "#f87171" },
    CERTIFIED:              { label: "Certified",    color: "#22c55e", dot: "#22c55e" },
    CERTIFIED_WITH_OVERRIDE:{ label: "Overridden",   color: "#f59e0b", dot: "#f59e0b" },
  };
  return map[status] || { label: status || "Unknown", color: "#6e87a2", dot: "#6e87a2" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SignalSlider({ sig, value, onChange }) {
  const passing = passesThreshold(sig, value);
  const pct = ((value - sig.min) / (sig.max - sig.min)) * 100;
  const accent = sig.lowerIsBetter
    ? passing ? "#34d399" : "#f87171"
    : passing ? "#22c55e" : "#f87171";

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "#8fadc4", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
          {sig.label}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "#6e87a2"
          }}>
            thr: {formatVal(sig, sig.threshold)}
          </span>
          <span style={{
            fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
            color: accent, fontWeight: 600, minWidth: 64, textAlign: "right"
          }}>
            {formatVal(sig, value)}
          </span>
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 4,
            background: passing ? "rgba(34,197,94,0.1)" : "rgba(248,113,113,0.1)",
            color: passing ? "#22c55e" : "#f87171", fontWeight: 600, letterSpacing: "0.04em"
          }}>
            {passing ? "PASS" : "FAIL"}
          </span>
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <input
          type="range"
          min={sig.min}
          max={sig.max}
          step={sig.step}
          value={value}
          onChange={e => onChange(sig.id, Number(e.target.value))}
          style={{
            width: "100%", height: 4, appearance: "none", background: `linear-gradient(to right, ${accent} ${pct}%, #18243a ${pct}%)`,
            borderRadius: 2, outline: "none", cursor: "pointer"
          }}
        />
      </div>
    </div>
  );
}

function SourceCard({ source, values, onValueChange, onFire, firing, lastResult, onReset }) {
  const allPass = source.signals.every(s => passesThreshold(s, values[s.id] ?? s.default));

  return (
    <div style={{
      background: "#080d16",
      border: `1px solid #18243a`,
      borderRadius: 16,
      overflow: "hidden",
      transition: "box-shadow 0.25s, border-color 0.25s",
      boxShadow: lastResult ? `0 0 32px ${source.glow}` : "none",
    }}>
      {/* Header */}
      <div style={{
        padding: "20px 22px 16px",
        borderBottom: "1px solid #0d1520",
        background: `linear-gradient(135deg, #0a1120 0%, #060810 100%)`,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              fontSize: 20,
              width: 36, height: 36,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: `${source.glow}`,
              borderRadius: 8,
              color: source.color
            }}>
              {source.icon}
            </span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#c4d4e8", fontFamily: "'DM Sans', sans-serif" }}>
                {source.name}
              </div>
              <div style={{ fontSize: 11, color: "#384d60", marginTop: 1 }}>{source.description}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              padding: "3px 8px", borderRadius: 5,
              background: `${source.glow}`, color: source.color,
              border: `1px solid ${source.color}22`
            }}>
              {source.tag}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
              padding: "3px 8px", borderRadius: 5,
              background: allPass ? "rgba(34,197,94,0.08)" : "rgba(248,113,113,0.08)",
              color: allPass ? "#22c55e" : "#f87171",
              border: `1px solid ${allPass ? "#22c55e22" : "#f8717122"}`
            }}>
              {allPass ? "All passing" : "Has failures"}
            </span>
          </div>
        </div>
      </div>

      {/* Sliders */}
      <div style={{ padding: "18px 22px 16px" }}>
        {source.signals.map(sig => (
          <SignalSlider
            key={sig.id}
            sig={sig}
            value={values[sig.id] ?? sig.default}
            onChange={onValueChange}
          />
        ))}
      </div>

      {/* Result banner */}
      {lastResult && (
        <div style={{
          margin: "0 22px 12px",
          padding: "10px 14px",
          borderRadius: 8,
          background: lastResult.ok
            ? "rgba(34,197,94,0.08)"
            : "rgba(248,113,113,0.08)",
          border: `1px solid ${lastResult.ok ? "#22c55e22" : "#f8717122"}`,
          fontSize: 12,
          color: lastResult.ok ? "#22c55e" : "#f87171",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {lastResult.ok ? (
            <>
              ✓ {lastResult.inserted} signal{lastResult.inserted !== 1 ? "s" : ""} ingested
              {lastResult.status && <> · status → <strong>{lastResult.status}</strong></>}
            </>
          ) : (
            <> ✗ {lastResult.error}</>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ padding: "0 22px 18px", display: "flex", gap: 8 }}>
        <button
          id={`sim-fire-${source.id}`}
          onClick={() => onFire(source.id)}
          disabled={firing}
          style={{
            flex: 1,
            padding: "10px 16px",
            borderRadius: 8,
            border: `1px solid ${source.color}55`,
            background: firing
              ? "#0d1520"
              : `linear-gradient(135deg, ${source.glow}, transparent)`,
            color: firing ? "#384d60" : source.color,
            fontSize: 13, fontWeight: 600,
            cursor: firing ? "not-allowed" : "pointer",
            fontFamily: "'DM Sans', sans-serif",
            transition: "all 0.2s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6
          }}
        >
          {firing ? (
            <><Spinner size={12} color={source.color} /> Ingesting…</>
          ) : (
            <>{source.icon} Ingest from {source.name}</>
          )}
        </button>
        <button
          onClick={() => onReset(source.id)}
          title="Reset to defaults"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #18243a",
            background: "#0a1120",
            color: "#384d60",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif",
            transition: "all 0.15s"
          }}
        >↺</button>
      </div>
    </div>
  );
}

function Spinner({ size = 14, color = "#22c55e" }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size,
      border: `2px solid ${color}33`,
      borderTopColor: color,
      borderRadius: "50%",
      animation: "vdk-spin 0.7s linear infinite",
      flexShrink: 0,
    }} />
  );
}

function ReleaseSelector({ releases, selectedId, onSelect, loading }) {
  const selected = releases.find(r => r.id === selectedId);
  const meta = selected ? getStatusMeta(selected.status) : null;

  return (
    <div style={{ position: "relative" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px",
        background: "#080d16",
        border: "1px solid #18243a",
        borderRadius: 10,
        minWidth: 320
      }}>
        {loading ? (
          <><Spinner /><span style={{ color: "#384d60", fontSize: 13 }}>Loading releases…</span></>
        ) : releases.length === 0 ? (
          <span style={{ color: "#384d60", fontSize: 13 }}>No releases found — create one first</span>
        ) : (
          <>
            {meta && (
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: meta.dot, flexShrink: 0,
                boxShadow: `0 0 6px ${meta.dot}`
              }} />
            )}
            <select
              id="sim-release-select"
              value={selectedId || ""}
              onChange={e => onSelect(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                color: "#c4d4e8",
                fontSize: 14,
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 500,
                outline: "none",
                cursor: "pointer",
                flex: 1,
                appearance: "none",
              }}
            >
              <option value="" disabled>Select a release…</option>
              {releases.map(r => (
                <option key={r.id} value={r.id} style={{ background: "#080d16" }}>
                  {r.version} · {getStatusMeta(r.status).label} · {r.environment || "pre-prod"}
                </option>
              ))}
            </select>
            {selected && (
              <span style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 4,
                background: `${getStatusMeta(selected.status).color}18`,
                color: getStatusMeta(selected.status).color,
                fontWeight: 600, letterSpacing: "0.05em",
                flexShrink: 0
              }}>
                {getStatusMeta(selected.status).label.toUpperCase()}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SignalSimulatorPage() {
  const navigate = useNavigate();
  const [releases, setReleases] = useState([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [selectedReleaseId, setSelectedReleaseId] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  // Per-source: current signal values
  const [values, setValues] = useState(() =>
    Object.fromEntries(SOURCES.map(s => [
      s.id,
      Object.fromEntries(s.signals.map(sig => [sig.id, sig.default]))
    ]))
  );

  // Per-source: firing state
  const [firing, setFiring] = useState(() => Object.fromEntries(SOURCES.map(s => [s.id, false])));

  // Per-source: last ingest result
  const [results, setResults] = useState(() => Object.fromEntries(SOURCES.map(s => [s.id, null])));

  const showToast = useCallback((msg, color = "#22c55e") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, color });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // Load releases from backend
  useEffect(() => {
    if (!hasBackend()) {
      setLoadingReleases(false);
      return;
    }
    let cancelled = false;
    setLoadingReleases(true);
    (async () => {
      try {
        const data = await apiGet(`/api/workspaces/${getWorkspaceId()}/releases?limit=50`, { navigate });
        if (cancelled) return;
        const rows = (data?.releases || []).filter(r =>
          r.status === "COLLECTING" || r.status === "UNCERTIFIED" || r.status === "CERTIFIED"
        );
        // Sort: COLLECTING first, then others
        rows.sort((a, b) => {
          if (a.status === "COLLECTING" && b.status !== "COLLECTING") return -1;
          if (b.status === "COLLECTING" && a.status !== "COLLECTING") return 1;
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
        setReleases(rows);
        if (rows.length > 0) setSelectedReleaseId(rows[0].id);
      } catch (e) {
        showToast(`Failed to load releases: ${e.message}`, "#f87171");
      } finally {
        if (!cancelled) setLoadingReleases(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, showToast]);

  const handleValueChange = useCallback((sourceId, signalId, value) => {
    setValues(prev => ({
      ...prev,
      [sourceId]: { ...prev[sourceId], [signalId]: value }
    }));
    // Clear result when values change
    setResults(prev => ({ ...prev, [sourceId]: null }));
  }, []);

  const handleReset = useCallback((sourceId) => {
    const src = SOURCES.find(s => s.id === sourceId);
    if (!src) return;
    setValues(prev => ({
      ...prev,
      [sourceId]: Object.fromEntries(src.signals.map(s => [s.id, s.default]))
    }));
    setResults(prev => ({ ...prev, [sourceId]: null }));
  }, []);

  const handleFire = useCallback(async (sourceId) => {
    if (!selectedReleaseId) {
      showToast("Select a release first", "#f59e0b");
      return;
    }
    if (!hasBackend()) {
      showToast("Backend required — this simulator needs a live connection", "#f59e0b");
      return;
    }

    const src = SOURCES.find(s => s.id === sourceId);
    const signals = values[sourceId] || {};

    setFiring(prev => ({ ...prev, [sourceId]: true }));
    setResults(prev => ({ ...prev, [sourceId]: null }));

    try {
      const out = await apiPost(
        `/api/releases/${selectedReleaseId}/signals`,
        {
          source: `simulator:${sourceId}`,
          signals
        },
        { navigate }
      );

      const status = out.computed_status || out.status || null;
      const inserted = out.inserted_count ?? Object.keys(signals).length;

      setResults(prev => ({
        ...prev,
        [sourceId]: { ok: true, inserted, status }
      }));

      // Refresh releases to pick up new status
      const refreshed = await apiGet(`/api/workspaces/${getWorkspaceId()}/releases?limit=50`, { navigate });
      const rows = (refreshed?.releases || []);
      rows.sort((a, b) => {
        if (a.status === "COLLECTING" && b.status !== "COLLECTING") return -1;
        if (b.status === "COLLECTING" && a.status !== "COLLECTING") return 1;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
      setReleases(rows);

      const newStatus = rows.find(r => r.id === selectedReleaseId)?.status;
      const statusLabel = getStatusMeta(newStatus || "COLLECTING").label;

      showToast(
        `${src.name} → ${Object.keys(signals).length} signals ingested · Release: ${statusLabel}`,
        newStatus === "CERTIFIED" ? "#22c55e" : newStatus === "UNCERTIFIED" ? "#f87171" : "#f59e0b"
      );
    } catch (e) {
      const errMsg = e.message || "Ingest failed";
      setResults(prev => ({ ...prev, [sourceId]: { ok: false, error: errMsg } }));
      showToast(`${src.name} ingest failed: ${errMsg}`, "#f87171");
    } finally {
      setFiring(prev => ({ ...prev, [sourceId]: false }));
    }
  }, [selectedReleaseId, values, navigate, showToast]);

  const selectedRelease = releases.find(r => r.id === selectedReleaseId);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#060810",
      fontFamily: "'DM Sans', sans-serif",
      padding: "0 0 60px",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #0d1520",
        padding: "24px 32px 20px",
        background: "linear-gradient(180deg, #080d16 0%, #060810 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <button
              onClick={() => navigate("/releases")}
              style={{
                background: "none", border: "none", color: "#384d60",
                fontSize: 13, cursor: "pointer", padding: "2px 0",
                fontFamily: "'DM Sans', sans-serif",
                display: "flex", alignItems: "center", gap: 4
              }}
            >
              ← Releases
            </button>
            <span style={{ color: "#18243a" }}>/</span>
            <span style={{ color: "#6e87a2", fontSize: 13 }}>Signal Simulator</span>
          </div>
          <h1 style={{
            fontSize: 22, fontWeight: 700, color: "#c4d4e8",
            letterSpacing: "-0.02em",
            fontFamily: "'DM Sans', sans-serif",
            margin: 0
          }}>
            Signal Simulator
          </h1>
          <p style={{ color: "#384d60", fontSize: 13, marginTop: 4, maxWidth: 480 }}>
            Mimic Braintrust, LangSmith, Sentry, and Datadog signal pushes against any collecting release.
            Tune values with sliders and ingest to trigger verdict evaluation.
          </p>
        </div>

        {/* Release selector */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#384d60", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Target release
          </span>
          <ReleaseSelector
            releases={releases}
            selectedId={selectedReleaseId}
            onSelect={setSelectedReleaseId}
            loading={loadingReleases}
          />
          {selectedRelease && (
            <div style={{ fontSize: 11, color: "#384d60", textAlign: "right" }}>
              env: <span style={{ color: "#6e87a2" }}>{selectedRelease.environment || "pre-prod"}</span>
              {" · "}deadline:{" "}
              <span style={{ color: "#6e87a2" }}>
                {selectedRelease.collection_deadline
                  ? new Date(selectedRelease.collection_deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : "open"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Info banner when no backend */}
      {!hasBackend() && (
        <div style={{
          margin: "24px 32px 0",
          padding: "12px 16px",
          borderRadius: 8,
          background: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.2)",
          color: "#f59e0b",
          fontSize: 13
        }}>
          ⚠ No backend detected — sign in and connect to a live workspace to use the simulator.
        </div>
      )}

      {/* Flow hint */}
      <div style={{ padding: "20px 32px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {[
          { step: "1", label: "Create PR with label", done: true },
          { step: "2", label: "Release appears (COLLECTING)", done: !!selectedReleaseId },
          { step: "3", label: "Ingest signals below", done: Object.values(results).some(r => r?.ok) },
          { step: "4", label: "→ CERTIFIED", done: Object.values(results).some(r => r?.status === "CERTIFIED") },
          { step: "5", label: "Merge PR → prod", done: false },
        ].map((item, i) => (
          <React.Fragment key={item.step}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              background: item.done ? "rgba(34,197,94,0.08)" : "#0a1120",
              border: `1px solid ${item.done ? "#22c55e33" : "#18243a"}`,
              fontSize: 12,
              color: item.done ? "#22c55e" : "#384d60",
              transition: "all 0.3s"
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%",
                background: item.done ? "#22c55e" : "#18243a",
                color: item.done ? "#060810" : "#384d60",
                fontSize: 10, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0
              }}>
                {item.done ? "✓" : item.step}
              </span>
              {item.label}
            </div>
            {i < 4 && <span style={{ color: "#18243a", fontSize: 12 }}>›</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Source cards grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
        gap: 20,
        padding: "24px 32px 0",
      }}>
        {SOURCES.map(source => (
          <SourceCard
            key={source.id}
            source={source}
            values={values[source.id] || {}}
            onValueChange={(signalId, value) => handleValueChange(source.id, signalId, value)}
            onFire={handleFire}
            firing={firing[source.id]}
            lastResult={results[source.id]}
            onReset={handleReset}
          />
        ))}
      </div>

      {/* Fire all button */}
      <div style={{ padding: "24px 32px 0", display: "flex", justifyContent: "center" }}>
        <button
          id="sim-fire-all"
          onClick={async () => {
            for (const src of SOURCES) {
              await handleFire(src.id);
            }
          }}
          disabled={!selectedReleaseId || Object.values(firing).some(Boolean)}
          style={{
            padding: "13px 36px",
            borderRadius: 10,
            border: "1px solid #22c55e44",
            background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(34,197,94,0.04))",
            color: "#22c55e",
            fontSize: 14, fontWeight: 600,
            cursor: selectedReleaseId ? "pointer" : "not-allowed",
            fontFamily: "'DM Sans', sans-serif",
            opacity: selectedReleaseId ? 1 : 0.4,
            letterSpacing: "0.01em",
            transition: "all 0.2s",
          }}
        >
          ⚡ Ingest All Sources at Once
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          padding: "11px 20px",
          borderRadius: 10,
          background: "#080d16",
          border: `1px solid ${toast.color}33`,
          color: toast.color,
          fontSize: 13, fontWeight: 500,
          boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 16px ${toast.color}22`,
          fontFamily: "'DM Sans', sans-serif",
          maxWidth: 440, textAlign: "center",
          zIndex: 9999,
          animation: "fadeUp 0.25s ease forwards",
          whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis"
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
