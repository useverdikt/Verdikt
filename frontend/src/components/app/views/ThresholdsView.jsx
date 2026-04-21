import React, { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../../../theme/tokens.js";
import { Btn } from "../../ui/Btn.jsx";

/** Stable JSON for dirty-checking threshold maps (sorted keys, numeric values only). */
function serializeThresholds(t) {
  if (!t || typeof t !== "object") return "{}";
  const sorted = {};
  for (const k of Object.keys(t).sort()) {
    const v = t[k];
    if (typeof v === "number" && !Number.isNaN(v)) sorted[k] = v;
  }
  return JSON.stringify(sorted);
}

export default function ThresholdsView({
  thresholds,
  signalCategories,
  isMobile,
  currentUser,
  canAct,
  onSave
}) {
  const [local, setLocal] = useState(() => ({ ...thresholds }));
  const [saved, setSaved] = useState(false);
  const [collapsedThr, setCollapsedThr] = useState(() => new Set());
  const lastPropSer = useRef(serializeThresholds(thresholds));

  useEffect(() => {
    const incoming = serializeThresholds(thresholds);
    if (incoming !== lastPropSer.current) {
      lastPropSer.current = incoming;
      setLocal({ ...thresholds });
    }
  }, [thresholds]);

  const isDirty = useMemo(
    () => serializeThresholds(local) !== serializeThresholds(thresholds),
    [local, thresholds]
  );

  const handleSave = async () => {
    if (!isDirty) return;
    await onSave(local);
    lastPropSer.current = serializeThresholds(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
          Two-layer quality standard: (1) AI output quality (accuracy, safety, tone, hallucination, relevance), and (2) delivery reliability (tests, manual QA, performance, stability). Define the minimum acceptable value for every signal. A release failing any threshold is blocked — and can only ship with a written override on permanent record.
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
              <div key={sig.id} style={{ padding: "14px 18px", borderBottom: i < cat.signals.length - 1 ? `1px solid ${C.border}` : "none", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto", alignItems: "center", gap: 20 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{sig.label}</span>
                    {sig.hardGate && <span title="Failure renders release permanently UNCERTIFIED — no override available" style={{ fontSize: 9, fontFamily: C.mono, color: C.red, background: C.redDim, padding: "1px 5px", borderRadius: 3, fontWeight: 700, cursor: "help" }}>HARD GATE — NO OVERRIDE</span>}
                    {sig.conditional && <span style={{ fontSize: 9, fontFamily: C.mono, color: C.amber, background: C.amberDim, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>CONDITIONAL</span>}
                  </div>
                  <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.55 }}>{sig.description}</div>
                </div>

                {sig.direction === "test" ? (
                  canAct(currentUser) ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: C.mono, fontSize: 9, color: C.muted, letterSpacing: "0.07em" }}>FLOOR</span>
                        <input type="number" min={0} max={100} value={local[sig.id] ?? 100} step={1} onChange={(e) => setLocal((t) => ({ ...t, [sig.id]: +e.target.value }))} style={{ width: 58, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 8px", color: C.accent, fontSize: 13, fontWeight: 700, fontFamily: C.mono, outline: "none", textAlign: "center" }} />
                        <span style={{ fontFamily: C.mono, fontSize: 12, color: C.muted }}>%</span>
                      </div>
                      <div style={{ fontSize: 9, color: C.muted, fontFamily: C.mono, textAlign: "right" }}>P0 → hard block · P1+ overridable</div>
                    </div>
                  ) : (
                    <div style={{ fontFamily: C.mono, fontSize: 11, color: C.green }}>≥ {local[sig.id] ?? 100}% · P0 → hard block</div>
                  )
                ) : sig.direction === "pass" ? (
                  <div style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: C.green }}>PASS required</div>
                ) : canAct(currentUser) ? (
                  sig.hasDelta ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: C.mono, fontSize: 9, color: C.muted, letterSpacing: "0.07em", minWidth: 52, textAlign: "right" }}>FLOOR</span>
                        <input type="number" value={local[sig.id]} step={0.1} onChange={(e) => setLocal((t) => ({ ...t, [sig.id]: +e.target.value }))} style={{ width: 64, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 8px", color: C.accent, fontSize: 13, fontWeight: 700, fontFamily: C.mono, outline: "none", textAlign: "center" }} />
                        <span style={{ fontFamily: C.mono, fontSize: 12, color: C.muted, minWidth: 18 }}>{sig.unit}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: C.mono, fontSize: 9, color: C.muted, letterSpacing: "0.07em", minWidth: 52, textAlign: "right" }}>MAX DROP</span>
                        <input type="number" value={local[`${sig.id}_delta`] ?? 5} step={1} onChange={(e) => setLocal((t) => ({ ...t, [`${sig.id}_delta`]: +e.target.value }))} style={{ width: 64, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 8px", color: C.pink, fontSize: 13, fontWeight: 700, fontFamily: C.mono, outline: "none", textAlign: "center" }} />
                        <span style={{ fontFamily: C.mono, fontSize: 12, color: C.muted, minWidth: 18 }}>pts</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input type="number" value={local[sig.id]} step={sig.unit === "s" || sig.unit === "%" ? 0.1 : sig.unit === "ms" ? 10 : 1} onChange={(e) => setLocal((t) => ({ ...t, [sig.id]: +e.target.value }))} style={{ width: 76, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px", color: C.accent, fontSize: 14, fontWeight: 700, fontFamily: C.mono, outline: "none", textAlign: "center" }} />
                      <span style={{ fontFamily: C.mono, fontSize: 13, color: C.muted }}>{sig.unit}</span>
                    </div>
                  )
                ) : sig.hasDelta ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: C.mono, fontSize: 9, color: C.dim, letterSpacing: "0.07em" }}>FLOOR</span>
                      <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: C.dim }}>{local[sig.id]}</span>
                      <span style={{ fontFamily: C.mono, fontSize: 12, color: C.dim }}>{sig.unit}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: C.mono, fontSize: 9, color: C.dim, letterSpacing: "0.07em" }}>MAX DROP</span>
                      <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: C.dim }}>{local[`${sig.id}_delta`] ?? 5}</span>
                      <span style={{ fontFamily: C.mono, fontSize: 12, color: C.dim }}>pts</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: C.dim }}>{local[sig.id]}</span>
                    <span style={{ fontFamily: C.mono, fontSize: 13, color: C.dim }}>{sig.unit}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
