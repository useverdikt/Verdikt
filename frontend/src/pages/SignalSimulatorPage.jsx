import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPost, getWorkspaceId, setWorkspaceId } from "../lib/apiClient.js";
import { refreshReleaseDetail } from "../lib/releaseDetailRefresh.js";
import { hasBackend } from "../lib/hasBackend.js";
import { filterSimulatorSourcesForMandatory, buildSimulatorThresholdMap, getSimulatorEmptyHint, getSimulatorReadiness } from "../lib/simulatorMandatorySignals.js";
import {
  SIMULATOR_SOURCES,
  applySimulatorThresholds,
  buildDefaultSimulatorValues,
  buildSimulatorIngestPayload,
  passesSimulatorSignal,
  formatSimulatorValue,
  SEVERITY_LEVELS
} from "../lib/simulatorSignalDefinitions.js";

// ─── Utilities ────────────────────────────────────────────────────────────────

function getStatusMeta(status) {
  const map = {
    COLLECTING:             { label: "COLLECTING",   color: "#f59e0b", dot: "#f59e0b" },
    UNCERTIFIED:            { label: "UNCERTIFIED",  color: "#f87171", dot: "#f87171" },
    CERTIFIED:              { label: "CERTIFIED",    color: "#22c55e", dot: "#22c55e" },
    CERTIFIED_WITH_OVERRIDE:{ label: "OVERRIDDEN",   color: "#f59e0b", dot: "#f59e0b" },
  };
  return map[status] || { label: status || "Unknown", color: "#6e87a2", dot: "#6e87a2" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SignalSlider({ sig, value, onChange }) {
  const passing = passesSimulatorSignal(sig, value);
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
            thr: {formatSimulatorValue(sig, sig.threshold)}
          </span>
          <span style={{
            fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
            color: accent, fontWeight: 600, minWidth: 64, textAlign: "right"
          }}>
            {formatSimulatorValue(sig, value)}
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

function SignalSeveritySelect({ sig, value, onChange }) {
  const passing = passesSimulatorSignal(sig, value);
  const accent = passing ? "#22c55e" : "#f87171";

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "#8fadc4", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
          {sig.label}
          {sig.hardGate && (
            <span style={{
              marginLeft: 8, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
              padding: "2px 6px", borderRadius: 4,
              background: "rgba(248,113,113,0.12)", color: "#f87171"
            }}>
              HARD GATE
            </span>
          )}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "#6e87a2" }}>
            block ≥ {sig.thresholdLabel}
          </span>
          <span style={{
            fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
            color: accent, fontWeight: 600, minWidth: 72, textAlign: "right"
          }}>
            {formatSimulatorValue(sig, value)}
          </span>
          <span style={{
            fontSize: 10, padding: "1px 6px", borderRadius: 4,
            background: passing ? "rgba(34,197,94,0.1)" : "rgba(248,113,113,0.1)",
            color: accent, fontWeight: 600, letterSpacing: "0.04em"
          }}>
            {passing ? "PASS" : "FAIL"}
          </span>
        </div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(sig.id, e.target.value)}
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 8,
          border: `1px solid ${passing ? "#22c55e33" : "#f8717133"}`,
          background: "#0a1120",
          color: accent,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', monospace",
          cursor: "pointer"
        }}
      >
        {SEVERITY_LEVELS.map((level) => (
          <option key={level} value={level} style={{ background: "#080d16" }}>
            {level === "none" ? "No defects found" : `Worst defect: ${level}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function SignalControl({ sig, value, onChange }) {
  if (sig.type === "severity") {
    return <SignalSeveritySelect sig={sig} value={value} onChange={onChange} />;
  }
  return <SignalSlider sig={sig} value={value} onChange={onChange} />;
}

function SourceCard({ source, values, onValueChange, onFire, firing, lastResult, onReset }) {
  const allPass = source.signals.every(s => passesSimulatorSignal(s, values[s.id] ?? s.default));

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
              background: source.sourceConnected ? "rgba(34,197,94,0.08)" : "rgba(245,158,11,0.08)",
              color: source.sourceConnected ? "#22c55e" : "#f59e0b",
              border: `1px solid ${source.sourceConnected ? "#22c55e22" : "#f59e0b22"}`
            }}>
              {source.sourceConnected ? "Connected" : "Sim only"}
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
          <SignalControl
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

function WorkspaceSelector({ workspaces, selectedId, onSelect, loading }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px",
      background: "#080d16",
      border: "1px solid #18243a",
      borderRadius: 10,
      minWidth: 280
    }}>
      {loading ? (
        <><Spinner /><span style={{ color: "#384d60", fontSize: 13 }}>Loading workspaces…</span></>
      ) : workspaces.length === 0 ? (
        <span style={{ color: "#384d60", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
          {selectedId || "No workspace"}
        </span>
      ) : (
        <select
          id="sim-workspace-select"
          value={selectedId || ""}
          onChange={(e) => onSelect(e.target.value)}
          style={{
            background: "transparent",
            border: "none",
            color: "#c4d4e8",
            fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 500,
            outline: "none",
            cursor: "pointer",
            flex: 1,
            appearance: "none",
          }}
        >
          {workspaces.map((ws) => (
            <option key={ws.workspace_id} value={ws.workspace_id} style={{ background: "#080d16" }}>
              {ws.workspace_id}
            </option>
          ))}
        </select>
      )}
    </div>
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

function ReadinessPanel({ readiness, backendOk, userRole, workspaceId, loading }) {
  if (!backendOk) return null;

  const roleBlocksIngest = userRole === "engineer";
  const statusColor = readiness.ready && !roleBlocksIngest ? "#22c55e" : "#f59e0b";

  return (
    <div style={{
      margin: "24px 32px 0",
      padding: "14px 18px",
      borderRadius: 10,
      background: "#080d16",
      border: `1px solid ${statusColor}33`,
      fontSize: 13,
      lineHeight: 1.55,
      color: "#8fadc4"
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: statusColor, marginBottom: 6 }}>
            Workspace readiness
          </div>
          <div style={{ color: "#c4d4e8", fontWeight: 500 }}>
            {loading
              ? "Loading workspace thresholds…"
              : readiness.ready
                ? `${readiness.panelCount} simulator panel${readiness.panelCount !== 1 ? "s" : ""} · ${readiness.requiredCount} required signal${readiness.requiredCount !== 1 ? "s" : ""}`
                : "Not ready — configure required signals first"}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#6e87a2" }}>
            Workspace <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{workspaceId}</span>
            {" · "}
            {readiness.connectedIntegrationCount} live integration{readiness.connectedIntegrationCount !== 1 ? "s" : ""} connected
            {readiness.requiredIds.length > 0 && (
              <> · Required: {readiness.requiredIds.join(", ")}</>
            )}
          </div>
        </div>
        <div style={{ fontSize: 12, maxWidth: 320 }}>
          {roleBlocksIngest ? (
            <span style={{ color: "#f87171" }}>
              Your role (<strong>engineer</strong>) is read-only — signal ingest will return 403. Use an AI Product Lead or VP Engineering account.
            </span>
          ) : readiness.requiredCount === 0 ? (
            <span>
              Mark signals as <strong>Required</strong> in{" "}
              <a href="/thresholds" style={{ color: "#22c55e" }}>App → Thresholds</a>, then Save.
              Default workspaces usually have the five AI metrics required after migration.
            </span>
          ) : (
            <span style={{ color: "#22c55e" }}>API connected · ingest enabled for your role</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SignalSimulatorPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const releaseFromQuery = searchParams.get("release");
  const workspaceFromQuery = searchParams.get("workspace");
  const [workspaceId, setWorkspaceIdState] = useState(() => workspaceFromQuery || getWorkspaceId());
  const [workspaces, setWorkspaces] = useState([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [releases, setReleases] = useState([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [selectedReleaseId, setSelectedReleaseId] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  // Per-source: current signal values
  const [values, setValues] = useState(() => buildDefaultSimulatorValues());

  // Per-source: firing state
  const [firing, setFiring] = useState(() => Object.fromEntries(SIMULATOR_SOURCES.map(s => [s.id, false])));

  // Per-source: last ingest result
  const [results, setResults] = useState(() => Object.fromEntries(SIMULATOR_SOURCES.map(s => [s.id, null])));

  const [thresholdMap, setThresholdMap] = useState(null);
  const [connectedSources, setConnectedSources] = useState(() => new Set());
  const [userRole, setUserRole] = useState(null);
  const [loadingWorkspaceConfig, setLoadingWorkspaceConfig] = useState(true);

  const workspaceRole = useMemo(
    () => workspaces.find((ws) => ws.workspace_id === workspaceId)?.role || userRole,
    [workspaces, workspaceId, userRole]
  );

  const readiness = useMemo(() => {
    if (!thresholdMap) return { requiredCount: 0, requiredIds: [], panelCount: 0, connectedIntegrationCount: 0, ready: false };
    return getSimulatorReadiness(thresholdMap, connectedSources, SIMULATOR_SOURCES);
  }, [thresholdMap, connectedSources]);

  const configuredSources = useMemo(() => {
    if (!thresholdMap) return applySimulatorThresholds(SIMULATOR_SOURCES);
    return applySimulatorThresholds(SIMULATOR_SOURCES, thresholdMap);
  }, [thresholdMap]);

  const activeSources = useMemo(() => {
    if (!hasBackend() || !thresholdMap) return configuredSources;
    return filterSimulatorSourcesForMandatory(configuredSources, thresholdMap, connectedSources);
  }, [configuredSources, thresholdMap, connectedSources]);

  const emptyHint = useMemo(() => {
    if (!hasBackend() || !thresholdMap || activeSources.length > 0) return null;
    return getSimulatorEmptyHint(thresholdMap, connectedSources, SIMULATOR_SOURCES);
  }, [thresholdMap, connectedSources, activeSources.length]);

  const showToast = useCallback((msg, color = "#22c55e") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, color });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // Load workspaces the signed-in user can access
  useEffect(() => {
    if (!hasBackend()) {
      setLoadingWorkspaces(false);
      return;
    }
    let cancelled = false;
    setLoadingWorkspaces(true);
    (async () => {
      try {
        const data = await apiGet("/api/auth/workspaces", { navigate });
        if (cancelled) return;
        const rows = data?.workspaces || [];
        setWorkspaces(rows);
        const preferred =
          (workspaceFromQuery && rows.some((w) => w.workspace_id === workspaceFromQuery) && workspaceFromQuery) ||
          (rows.some((w) => w.workspace_id === workspaceId) && workspaceId) ||
          rows[0]?.workspace_id ||
          workspaceId;
        if (preferred && preferred !== workspaceId) {
          setWorkspaceIdState(preferred);
          setWorkspaceId(preferred);
        }
      } catch (e) {
        if (!cancelled) showToast(`Failed to load workspaces: ${e.message}`, "#f87171");
      } finally {
        if (!cancelled) setLoadingWorkspaces(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, showToast, workspaceFromQuery]);

  const handleWorkspaceChange = useCallback((nextId) => {
    if (!nextId || nextId === workspaceId) return;
    setWorkspaceId(nextId);
    setWorkspaceIdState(nextId);
    setSelectedReleaseId(null);
    setReleases([]);
    setThresholdMap(null);
    setConnectedSources(new Set());
    setResults(() => Object.fromEntries(SIMULATOR_SOURCES.map((s) => [s.id, null])));
    setValues(() => buildDefaultSimulatorValues());
  }, [workspaceId]);

  // Load releases from backend
  useEffect(() => {
    if (!hasBackend() || !workspaceId) {
      setLoadingReleases(false);
      return;
    }
    let cancelled = false;
    setLoadingReleases(true);
    (async () => {
      try {
        const data = await apiGet(`/api/workspaces/${workspaceId}/releases?limit=50`, { navigate });
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
        const preferred =
          (releaseFromQuery && rows.some((r) => r.id === releaseFromQuery) && releaseFromQuery) ||
          rows[0]?.id ||
          null;
        if (preferred) setSelectedReleaseId(preferred);
      } catch (e) {
        showToast(`Failed to load releases: ${e.message}`, "#f87171");
      } finally {
        if (!cancelled) setLoadingReleases(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, showToast, releaseFromQuery, workspaceId]);

  useEffect(() => {
    if (!hasBackend()) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await apiGet("/api/auth/me", { navigate });
        if (!cancelled) setUserRole(me?.user?.role || null);
      } catch (_) {
        if (!cancelled) setUserRole(null);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  useEffect(() => {
    if (!hasBackend() || !workspaceId) {
      setLoadingWorkspaceConfig(false);
      return;
    }
    let cancelled = false;
    setLoadingWorkspaceConfig(true);
    (async () => {
      try {
        const [thrData, intData] = await Promise.all([
          apiGet(`/api/workspaces/${workspaceId}/thresholds`, { navigate }),
          apiGet(`/api/workspaces/${workspaceId}/signal-integrations`, { navigate })
        ]);
        if (cancelled) return;
        setThresholdMap(buildSimulatorThresholdMap(thrData?.thresholds || {}));
        const connected = new Set(
          (intData?.integrations || [])
            .filter((row) => row.connected === true)
            .map((row) => String(row.source_id || "").trim())
            .filter(Boolean)
        );
        setConnectedSources(connected);
      } catch (_) {
        /* fall back to all sources when config unavailable */
      } finally {
        if (!cancelled) setLoadingWorkspaceConfig(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, workspaceId]);

  const handleValueChange = useCallback((sourceId, signalId, value) => {
    setValues(prev => ({
      ...prev,
      [sourceId]: { ...prev[sourceId], [signalId]: value }
    }));
    // Clear result when values change
    setResults(prev => ({ ...prev, [sourceId]: null }));
  }, []);

  const handleReset = useCallback((sourceId) => {
    const src = activeSources.find(s => s.id === sourceId) || configuredSources.find(s => s.id === sourceId);
    if (!src) return;
    setValues(prev => ({
      ...prev,
      [sourceId]: Object.fromEntries(src.signals.map(s => [s.id, s.default]))
    }));
    setResults(prev => ({ ...prev, [sourceId]: null }));
  }, [activeSources, configuredSources]);

  const handleFire = useCallback(async (sourceId) => {
    if (!selectedReleaseId) {
      showToast("Select a release first", "#f59e0b");
      return;
    }
    if (!hasBackend()) {
      showToast("Backend required — this simulator needs a live connection", "#f59e0b");
      return;
    }

    const src = activeSources.find(s => s.id === sourceId) || configuredSources.find(s => s.id === sourceId);
    const signals = buildSimulatorIngestPayload(src, values[sourceId] || {});

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

      const mapped = await refreshReleaseDetail(selectedReleaseId, navigate, { emit: true });
      setReleases((prev) => {
        const next = prev.map((r) =>
          r.id === selectedReleaseId
            ? {
                ...r,
                status: mapped.status || r.status,
                environment: mapped.environment ?? r.environment,
                version: mapped.version ?? r.version
              }
            : r
        );
        return next;
      });

      const newStatus = mapped.status || status;
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
  }, [selectedReleaseId, values, navigate, showToast, activeSources, configuredSources]);

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
          <p style={{ color: "#384d60", fontSize: 13, marginTop: 4, maxWidth: 520 }}>
            Ingest mandatory certification signals marked Required in App → Thresholds — all integration sources plus Manual QA (pass rate and showstopper severity). Simulated ingest works without live integrations.
          </p>
        </div>

        {/* Workspace + release selectors */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#384d60", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Workspace
            </span>
            <WorkspaceSelector
              workspaces={workspaces}
              selectedId={workspaceId}
              onSelect={handleWorkspaceChange}
              loading={loadingWorkspaces}
            />
          </div>
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

      <ReadinessPanel
        readiness={readiness}
        backendOk={hasBackend()}
        userRole={workspaceRole}
        workspaceId={workspaceId}
        loading={loadingWorkspaceConfig}
      />

      {hasBackend() && emptyHint && (
        <div style={{
          margin: "24px 32px 0",
          padding: "12px 16px",
          borderRadius: 8,
          background: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.2)",
          color: "#f59e0b",
          fontSize: 13,
          lineHeight: 1.55
        }}>
          <strong style={{ color: "#fbbf24", display: "block", marginBottom: 4 }}>{emptyHint.title}</strong>
          {emptyHint.body}
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
        {activeSources.map(source => (
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
            for (const src of activeSources) {
              await handleFire(src.id);
            }
          }}
          disabled={!selectedReleaseId || activeSources.length === 0 || Object.values(firing).some(Boolean)}
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
