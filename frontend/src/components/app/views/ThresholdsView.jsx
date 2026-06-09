import React, { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../../../theme/tokens.js";
import { Btn } from "../../ui/Btn.jsx";

/** Stable JSON for dirty-checking threshold maps (sorted keys, numeric + string values). */
function serializeThresholds(t) {
  if (!t || typeof t !== "object") return "{}";
  const sorted = {};
  for (const k of Object.keys(t).sort()) {
    const v = t[k];
    if (typeof v === "number" && !Number.isNaN(v)) sorted[k] = v;
    else if (typeof v === "string" && v !== "") sorted[k] = v;
  }
  return JSON.stringify(sorted);
}

function serializeRequired(r) {
  if (!r || typeof r !== "object") return "{}";
  const sorted = {};
  for (const k of Object.keys(r).sort()) {
    sorted[k] = !!r[k];
  }
  return JSON.stringify(sorted);
}

export default function ThresholdsView({
  thresholds,
  thresholdRequired,
  defaultThresholds = {},
  signalCategories,
  isMobile,
  currentUser,
  canAct,
  onSave,
  suggestions = [],
  suggestNote = "",
  onApplySuggestion,
  onDismissSuggestion
}) {
  const [local, setLocal] = useState(() => ({ ...defaultThresholds, ...thresholds }));
  const [localRequired, setLocalRequired] = useState(() => ({ ...thresholdRequired }));
  const [saved, setSaved] = useState(false);
  const [collapsedThr, setCollapsedThr] = useState(() => new Set());
  const lastPropSer = useRef(serializeThresholds(thresholds));
  const lastReqSer = useRef(serializeRequired(thresholdRequired));

  useEffect(() => {
    const incoming = serializeThresholds(thresholds);
    const incomingReq = serializeRequired(thresholdRequired);
    if (incoming !== lastPropSer.current || incomingReq !== lastReqSer.current) {
      lastPropSer.current = incoming;
      lastReqSer.current = incomingReq;
      setLocal({ ...defaultThresholds, ...thresholds });
      setLocalRequired({ ...thresholdRequired });
    }
  }, [thresholds, thresholdRequired, defaultThresholds]);

  const isDirty = useMemo(
    () =>
      serializeThresholds(local) !== serializeThresholds(thresholds) ||
      serializeRequired(localRequired) !== serializeRequired(thresholdRequired),
    [local, localRequired, thresholds, thresholdRequired]
  );

  const handleSave = async () => {
    if (!isDirty) return;
    await onSave(local, localRequired);
    lastPropSer.current = serializeThresholds(local);
    lastReqSer.current = serializeRequired(localRequired);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const suggestListNote =
    suggestNote ||
    (suggestions.length
      ? `${suggestions.length} suggestion${suggestions.length > 1 ? "s" : ""} available`
      : "No active suggestions in the current analysis window.");

  const val = (sigOrId) => {
    const id = typeof sigOrId === "string" ? sigOrId : sigOrId.id;
    const v = local[id];
    if (v !== undefined && v !== null && v !== "") return v;
    return defaultThresholds[id];
  };

  const renderValueControl = (sig) => {
    if (sig.direction === "test") {
      const severityHint =
        sig.id === "e2e_regression"
          ? "P0 → hard block · P3/P4 overridable"
          : "P0 → hard block · P1+ overridable";
      return canAct(currentUser) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: C.mono, fontSize: 9, color: C.muted, letterSpacing: "0.07em" }}>FLOOR</span>
            <input type="number" min={0} max={100} value={val(sig) ?? 100} step={1} onChange={(e) => setLocal((t) => ({ ...t, [sig.id]: +e.target.value }))} style={{ width: 58, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 8px", color: C.accent, fontSize: 13, fontWeight: 700, fontFamily: C.mono, outline: "none", textAlign: "center" }} />
            <span style={{ fontFamily: C.mono, fontSize: 12, color: C.muted }}>%</span>
          </div>
          <div style={{ fontSize: 9, color: C.muted, fontFamily: C.mono, textAlign: "right" }}>{severityHint}</div>
        </div>
      ) : (
        <div style={{ fontFamily: C.mono, fontSize: 11, color: C.green }}>≥ {val(sig) ?? 100}% · P0 → hard block</div>
      );
    }

    if (sig.direction === "pass") {
      return <div style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: C.green }}>PASS required</div>;
    }

    if (sig.direction === "select") {
      const options = sig.selectOptions || [];
      const value = String(val(sig) ?? options[0] ?? "");
      return canAct(currentUser) ? (
        <select
          value={value}
          onChange={(e) => setLocal((t) => ({ ...t, [sig.id]: e.target.value }))}
          style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px", color: C.text, fontSize: 13, fontFamily: C.mono, outline: "none", minWidth: 88 }}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <div style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: C.dim }}>{value}</div>
      );
    }

    if (canAct(currentUser)) {
      if (sig.hasDelta) {
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: C.mono, fontSize: 9, color: C.muted, letterSpacing: "0.07em", minWidth: 52, textAlign: "right" }}>FLOOR</span>
              <input type="number" value={val(sig)} step={0.1} onChange={(e) => setLocal((t) => ({ ...t, [sig.id]: +e.target.value }))} style={{ width: 64, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 8px", color: C.accent, fontSize: 13, fontWeight: 700, fontFamily: C.mono, outline: "none", textAlign: "center" }} />
              <span style={{ fontFamily: C.mono, fontSize: 12, color: C.muted, minWidth: 18 }}>{sig.unit}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: C.mono, fontSize: 9, color: C.muted, letterSpacing: "0.07em", minWidth: 52, textAlign: "right" }}>MAX DROP</span>
              <input type="number" value={val(`${sig.id}_delta`)} step={1} onChange={(e) => setLocal((t) => ({ ...t, [`${sig.id}_delta`]: +e.target.value }))} style={{ width: 64, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 8px", color: C.pink, fontSize: 13, fontWeight: 700, fontFamily: C.mono, outline: "none", textAlign: "center" }} />
              <span style={{ fontFamily: C.mono, fontSize: 12, color: C.muted, minWidth: 18 }}>pts</span>
            </div>
          </div>
        );
      }
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="number" value={val(sig)} step={sig.unit === "s" || sig.unit === "%" ? 0.1 : sig.unit === "ms" ? 10 : 1} onChange={(e) => setLocal((t) => ({ ...t, [sig.id]: +e.target.value }))} style={{ width: 76, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px", color: C.accent, fontSize: 14, fontWeight: 700, fontFamily: C.mono, outline: "none", textAlign: "center" }} />
          <span style={{ fontFamily: C.mono, fontSize: 13, color: C.muted }}>{sig.unit}</span>
        </div>
      );
    }

    if (sig.hasDelta) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: C.mono, fontSize: 9, color: C.dim, letterSpacing: "0.07em" }}>FLOOR</span>
            <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: C.dim }}>{val(sig)}</span>
            <span style={{ fontFamily: C.mono, fontSize: 12, color: C.dim }}>{sig.unit}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: C.mono, fontSize: 9, color: C.dim, letterSpacing: "0.07em" }}>MAX DROP</span>
            <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: C.dim }}>{val(`${sig.id}_delta`)}</span>
            <span style={{ fontFamily: C.mono, fontSize: 12, color: C.dim }}>pts</span>
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: C.dim }}>{val(sig)}</span>
        {sig.unit ? <span style={{ fontFamily: C.mono, fontSize: 13, color: C.dim }}>{sig.unit}</span> : null}
      </div>
    );
  };

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 920, margin: "0 auto", width: "100%" }}>
      <div style={{ paddingBottom: 18, marginBottom: 4, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontFamily: C.mono, fontSize: 10, letterSpacing: "0.11em", textTransform: "uppercase", color: C.dim, marginBottom: 6 }}>Policy</div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ margin: 0, fontFamily: C.serif, fontSize: 28, fontWeight: 600, color: C.text, letterSpacing: "-0.01em", lineHeight: 1.1, flex: "1 1 auto", minWidth: 0 }}>Thresholds</h2>
          {canAct(currentUser) ? (
            <Btn
              variant={saved ? "green" : "primary"}
              onClick={handleSave}
              disabled={!isDirty}
              style={{ flexShrink: 0 }}
            >
              {saved ? "✓ Saved" : "Save Thresholds"}
            </Btn>
          ) : (
            <span style={{ fontSize: 10, color: C.dim, background: C.border, padding: "4px 10px", borderRadius: 5, fontFamily: C.mono, fontWeight: 700, letterSpacing: "0.08em", flexShrink: 0 }}>
              READ ONLY
            </span>
          )}
        </div>
        <p style={{ margin: "14px 0 0", color: C.muted, fontSize: 13, lineHeight: 1.65, maxWidth: 640 }}>
          Set threshold values and mark signals as <strong style={{ color: C.text, fontWeight: 600 }}>required for certification</strong>. Only required signals from connected sources gate release status. Optional signals can stay configured without blocking collection.
        </p>
      </div>

      {signalCategories.map((cat) => (
        <div key={cat.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
          <button
            type="button"
            onClick={() =>
              setCollapsedThr((prev) => {
                const next = new Set(prev);
                if (next.has(cat.id)) next.delete(cat.id);
                else next.add(cat.id);
                return next;
              })
            }
            aria-expanded={!collapsedThr.has(cat.id)}
            style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: C.raise, border: "none", borderRadius: 0, cursor: "pointer", font: "inherit", color: "inherit" }}
          >
            <span style={{ fontSize: 10, color: C.muted, width: 14, flexShrink: 0, fontFamily: C.mono }}>{collapsedThr.has(cat.id) ? "▶" : "▼"}</span>
            <span style={{ color: cat.color, fontSize: 14 }}>{cat.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{cat.label}</span>
            <span style={{ fontSize: 12, color: C.muted, flex: "1 1 160px", minWidth: 0 }}>{cat.description}</span>
            {cat.id === "ai" && (
              <span style={{ marginLeft: "auto", fontFamily: C.mono, fontSize: 9, color: C.pink, background: "rgba(244,114,182,0.08)", border: "1px solid rgba(244,114,182,0.2)", borderRadius: 4, padding: "2px 8px", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
                TWO-LAYER · FLOOR + MAX DROP
              </span>
            )}
          </button>
          <div style={{ display: collapsedThr.has(cat.id) ? "none" : "block" }}>
            {cat.signals.map((sig, i) => (
              <div key={sig.id} style={{ padding: "14px 18px", borderBottom: i < cat.signals.length - 1 ? `1px solid ${C.border}` : "none", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto auto", alignItems: "center", gap: 20 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{sig.label}</span>
                    {!sig.id.endsWith("_delta") && sig.direction !== "select" && localRequired[sig.id] && (
                      <span style={{ fontSize: 9, fontFamily: C.mono, color: C.accent, background: "rgba(56,189,248,0.08)", padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>REQUIRED</span>
                    )}
                    {sig.hardGate && <span title="Failure renders release permanently UNCERTIFIED — no override available" style={{ fontSize: 9, fontFamily: C.mono, color: C.red, background: C.redDim, padding: "1px 5px", borderRadius: 3, fontWeight: 700, cursor: "help" }}>HARD GATE — NO OVERRIDE</span>}
                    {sig.conditional && <span style={{ fontSize: 9, fontFamily: C.mono, color: C.amber, background: C.amberDim, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>CONDITIONAL</span>}
                  </div>
                  <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.55 }}>{sig.description}</div>
                </div>

                {renderValueControl(sig)}

                {!sig.id.endsWith("_delta") && sig.direction !== "select" && (
                  canAct(currentUser) ? (
                    <label style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, cursor: "pointer", userSelect: "none" }}>
                      <span style={{ fontFamily: C.mono, fontSize: 9, color: C.muted, letterSpacing: "0.07em" }}>REQUIRED</span>
                      <input
                        type="checkbox"
                        checked={!!localRequired[sig.id]}
                        onChange={(e) => setLocalRequired((r) => ({ ...r, [sig.id]: e.target.checked }))}
                        style={{ width: 16, height: 16, accentColor: C.accent }}
                      />
                    </label>
                  ) : (
                    <div style={{ fontFamily: C.mono, fontSize: 10, color: localRequired[sig.id] ? C.accent : C.dim }}>
                      {localRequired[sig.id] ? "Required" : "Optional"}
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, background: C.raise }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Threshold suggestions</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Data-driven suggestions from recent release outcomes and MISS/OVER_BLOCK patterns.</div>
        </div>
        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: C.mono, marginBottom: 12 }}>{suggestListNote}</div>
          {suggestions.length === 0 ? null : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {suggestions.map((s) => (
                <div key={s.id || s.signal_id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontFamily: C.mono, fontSize: 11, color: C.accent, fontWeight: 700, marginBottom: 4 }}>{s.signal_id}</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, marginBottom: 8 }}>{s.reason || ""}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontFamily: C.mono, fontSize: 11, marginBottom: 10 }}>
                    <span style={{ color: C.dim }}>{s.direction === "max" ? "max" : "min"}: {s.current}</span>
                    <span style={{ color: C.muted }}>→</span>
                    <span style={{ color: C.text, fontWeight: 700 }}>{s.suggested}</span>
                    <span style={{ color: C.muted }}>{Math.round((s.confidence || 0) * 100)}% confidence</span>
                  </div>
                  {canAct(currentUser) && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn variant="primary" onClick={() => onApplySuggestion?.(String(s.id || ""))} style={{ fontSize: 11, padding: "6px 14px" }}>
                        Apply
                      </Btn>
                      <Btn variant="ghost" onClick={() => onDismissSuggestion?.(String(s.id || ""))} style={{ fontSize: 11, padding: "6px 12px" }}>
                        Dismiss
                      </Btn>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
