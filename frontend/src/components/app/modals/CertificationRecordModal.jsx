import React, { useEffect, useRef } from "react";
import { C } from "../../../theme/tokens.js";
import RecommendationPanel from "../RecommendationPanel.jsx";

function useModalLayer(onClose) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key !== "Escape" || !closeRef.current) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, []);
}

export default function CertificationRecordModal({
  release,
  thresholds,
  onClose,
  onShareSnapshot,
  calcVerdict,
  releaseTypes,
  signalCategories,
  calcCategoryStatus,
  catStatusColor,
  getRegressionRequired,
  evaluateSignal,
  fmtVal,
  certSig,
  backendReleaseId
}) {
  const titleId = React.useId();
  useModalLayer(onClose);
  const [isMobile, setIsMobile] = React.useState(() => window.innerWidth <= 900);
  React.useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  const { failing } = calcVerdict(release.signals, thresholds, release.releaseType);
  const rt = releaseTypes.find((r) => r.id === release.releaseType);
  const statusColor = { shipped: C.green, overridden: C.amber, blocked: C.red, pending: C.accent }[release.status] || C.accent;
  const statusLabel = { shipped: "CERTIFIED", overridden: "CERTIFIED WITH OVERRIDE", blocked: "UNCERTIFIED", pending: "PENDING" }[release.status] || "PENDING";

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000e0", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: isMobile ? 10 : 20, backdropFilter: "blur(6px)" }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="scale-in" style={{ background: C.raise, border: `1px solid ${C.borderL}`, borderRadius: isMobile ? 12 : 18, maxWidth: 640, width: "100%", boxShadow: "0 32px 100px #00000090", maxHeight: isMobile ? "96vh" : "90vh", overflowY: "auto" }}>
        <div style={{ background: C.surface, padding: isMobile ? "12px 12px" : "16px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "center", justifyContent: "space-between", borderRadius: isMobile ? "12px 12px 0 0" : "18px 18px 0 0", gap: isMobile ? 10 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, color: C.dim }} aria-hidden="true">⊠</span>
            <div>
              <div style={{ fontSize: 10, color: C.muted, fontFamily: C.mono, fontWeight: 700, letterSpacing: "0.12em" }}>CERTIFICATION RECORD</div>
              <div id={titleId} style={{ fontSize: 15, fontWeight: 800, color: C.text, marginTop: 1 }}>{release.version} · {release.date}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <a href="/badge" target="_blank" rel="noopener" style={{ fontSize: 11, color: C.accentBright, fontFamily: C.mono, fontWeight: 700, textDecoration: "none", background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 6, padding: "5px 12px" }}>View public record →</a>
            {typeof onShareSnapshot === "function" && (
              <button
                type="button"
                onClick={() => onShareSnapshot(release)}
                style={{
                  fontSize: 11,
                  color: C.text,
                  fontFamily: C.mono,
                  fontWeight: 700,
                  background: C.border,
                  border: `1px solid ${C.borderL}`,
                  borderRadius: 6,
                  padding: "5px 12px",
                  cursor: "pointer"
                }}
              >
                Share snapshot
              </button>
            )}
            <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", color: C.muted, fontSize: 18, cursor: "pointer", padding: "4px 8px" }}>✕</button>
          </div>
        </div>
        <div style={{ background: "#0a0b0e", borderBottom: `1px solid ${C.border}`, padding: "9px 24px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: C.dim }}>⊠</span>
          <span style={{ fontSize: 11, fontFamily: C.mono, color: C.dim, letterSpacing: "0.06em" }}>This record is permanent. It cannot be edited or deleted.</span>
          {certSig && (
            <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: C.mono, color: C.green, opacity: 0.7, letterSpacing: "0.04em" }} title={`Payload hash: ${certSig.payload_hash}`}>
              ⊕ cryptographically signed · {certSig.algorithm}
            </span>
          )}
        </div>
        <div style={{ padding: "24px" }}>
          <div style={{ background: statusColor + "10", border: `1px solid ${statusColor}30`, borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: statusColor + "15", border: `1px solid ${statusColor}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: statusColor, flexShrink: 0 }}>{release.status === "shipped" ? "⊕" : release.status === "overridden" ? "⚠" : release.status === "blocked" ? "⊗" : "◎"}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: C.mono, fontSize: 11, fontWeight: 700, color: statusColor, letterSpacing: "0.1em", marginBottom: 3 }}>{statusLabel}</div>
              <div style={{ fontSize: 12, color: C.muted }}>
                {rt && <span style={{ marginRight: 10 }}>{rt.icon} {rt.label}</span>}
                {release.status === "shipped" && release.shippedBy && <span>Certified by {release.shippedBy}</span>}
                {release.status === "overridden" && release.overrideBy && <span>Override by {release.overrideBy}</span>}
                {release.status === "blocked" && <span>Hard gate failure — no override available</span>}
              </div>
            </div>
          </div>

          {release.status === "overridden" && (
            <div style={{ background: C.amberDim, border: `1px solid ${C.amber}30`, borderRadius: 10, padding: "14px 18px", marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: C.amber, fontWeight: 700, fontFamily: C.mono, letterSpacing: "0.1em", marginBottom: 6 }}>OVERRIDE — {release.overrideBy?.toUpperCase()}</div>
              <div style={{ fontSize: 13, color: C.text, lineHeight: 1.7 }}>{release.overrideReason}</div>
            </div>
          )}

          {release.regressionWaiver && (
            <div style={{ background: C.amberDim, border: `1px solid ${C.amber}25`, borderRadius: 10, padding: "12px 18px", marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: C.amber, fontWeight: 700, fontFamily: C.mono, letterSpacing: "0.1em", marginBottom: 4 }}>E2E REGRESSION WAIVED — {release.regressionWaiver.waivedBy?.toUpperCase()}</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{release.regressionWaiver.reason}</div>
            </div>
          )}

          {/* Recommendation Panel */}
          {backendReleaseId && (
            <div style={{ marginBottom: 16 }}>
              <RecommendationPanel releaseId={backendReleaseId} />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: failing.length > 0 ? 16 : 0 }}>
            {signalCategories.map((cat) => {
              const status = calcCategoryStatus(cat.id, release.signals, thresholds, release.releaseType);
              const sc = catStatusColor(status);
              const catSignals = cat.signals
                .map((sig) => {
                  const val = release.signals[sig.id];
                  const reqd = getRegressionRequired(release.releaseType);
                  const isWaived = sig.conditional && (val === null || val === undefined || reqd === false);
                  if (isWaived) return { label: sig.label, display: "WAIVED", color: C.amber };
                  if (val === undefined || val === null) return null;
                  const { pass } = evaluateSignal(sig, val, thresholds[sig.id]);
                  return { label: sig.label, display: fmtVal(sig, val), color: pass ? C.green : C.red };
                })
                .filter(Boolean);
              return (
                <div key={cat.id} style={{ background: C.surface, border: `1px solid ${sc}25`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: cat.color }}>{cat.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{cat.label}</span>
                    <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: sc, boxShadow: `0 0 6px ${sc}66` }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {catSignals.map((s, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{s.label}</span>
                        <span style={{ fontSize: 10, fontFamily: C.mono, fontWeight: 700, color: s.color, flexShrink: 0 }}>{s.display}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {failing.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.red}25`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.red }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: C.red, fontFamily: C.mono, letterSpacing: "0.08em" }}>SIGNALS BELOW THRESHOLD ({failing.length})</span>
              </div>
              {failing.map((f, i) => (
                <div key={i} style={{ padding: "9px 16px", borderBottom: i < failing.length - 1 ? `1px solid ${C.border}` : "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12, color: C.text }}>{f.catLabel} · {f.sigLabel}</span>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: C.red }}>{fmtVal({ direction: f.direction, unit: f.unit }, f.value)}</span>
                    <span style={{ fontFamily: C.mono, fontSize: 10, color: C.dim, marginLeft: 6 }}>{f.direction === "above" ? "needs ≥" : "needs ≤"}{f.threshold}{f.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
