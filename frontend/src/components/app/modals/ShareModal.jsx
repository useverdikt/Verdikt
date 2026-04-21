import React, { useEffect, useState } from "react";
import { C } from "../../../theme/tokens.js";
import { Logo } from "../CommonControls.jsx";

function useModalLayer(onClose) {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key !== "Escape" || !onClose) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
}

export default function ShareModal({
  release,
  thresholds,
  project,
  onClose,
  calcVerdict,
  calcCategoryStatus,
  releaseTypes,
  signalCategories,
  catStatusColor,
  fmtVal,
  genCertSummary
}) {
  const titleId = React.useId();
  useModalLayer(onClose);
  const isMobile = window.innerWidth <= 900;
  const { recommendation, failing, isHardBlock } = calcVerdict(release.signals, thresholds, release.releaseType);
  const isShip = recommendation === "SHIP";
  const color = isShip ? C.green : C.red;
  const [copied, setCopied] = useState(false);
  const rt = releaseTypes.find((r) => r.id === release.releaseType);

  const copy = () => {
    navigator.clipboard?.writeText(window.location.href).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000000e0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 220,
        padding: isMobile ? 10 : 20,
        backdropFilter: "blur(6px)"
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="scale-in"
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: isMobile ? 12 : 20,
          maxWidth: 620,
          width: "100%",
          boxShadow: "0 40px 120px #00000090",
          maxHeight: isMobile ? "96vh" : "90vh",
          overflowY: "auto"
        }}
      >
        <div
          style={{
            background: C.raise,
            padding: isMobile ? "14px 12px" : "18px 26px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: isMobile ? 10 : 0
          }}
        >
          <Logo />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={copy}
              style={{
                background: C.accentDim,
                color: C.accentBright,
                border: `1px solid ${C.accent}30`,
                borderRadius: 7,
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: C.mono
              }}
            >
              {copied ? "✓ Copied" : "⧉ Copy link"}
            </button>
            <button
              onClick={onClose}
              style={{ background: "transparent", border: "none", color: C.muted, fontSize: 18, cursor: "pointer", padding: "4px 8px" }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ padding: isMobile ? "16px 12px" : "26px 30px" }}>
          <div style={{ fontSize: 12, color: C.muted, fontFamily: C.mono, marginBottom: 4 }}>
            {project?.name} · {project?.feature} · {rt ? `${rt.icon} ${rt.label}` : ""}
          </div>

          <div
            style={{
              background: isShip ? "linear-gradient(135deg,#0a1a12,#0d1f16)" : "linear-gradient(135deg,#1a0a0c,#1f0d10)",
              border: `1px solid ${color}30`,
              borderRadius: 14,
              padding: "22px 26px",
              marginBottom: 22,
              marginTop: 8
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: color + "15",
                  border: `1px solid ${color}40`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  color
                }}
                aria-hidden="true"
              >
                {isShip ? "⊕" : "⊗"}
              </div>
              <div>
                <div style={{ color: C.muted, fontSize: 10, fontFamily: C.mono, fontWeight: 700, letterSpacing: "0.14em", marginBottom: 4 }}>
                  VERDIKT · {release.version} · {release.date}
                </div>
                <div id={titleId} style={{ color, fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em" }}>
                  {isShip ? "Certified" : "Uncertified"}
                </div>
                <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                  {isHardBlock ? "Hard gate failure · " : ""}
                  {failing.length === 0 ? "All signals passing" : `${failing.length} signal${failing.length > 1 ? "s" : ""} below threshold`}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: release.regressionWaiver ? 16 : 22 }}>
            {signalCategories.map((cat) => {
              const status = calcCategoryStatus(cat.id, release.signals, thresholds, release.releaseType);
              const computed = catStatusColor(status);
              const statusText = status === "pass" ? "CERTIFIED" : status === "fail" ? "UNCERTIFIED" : status === "waived" ? "WAIVED" : "—";
              return (
                <div key={cat.id} style={{ background: C.raise, border: `1px solid ${computed}30`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: cat.color }}>{cat.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{cat.label}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: computed }} />
                    <span style={{ fontSize: 11, color: computed, fontFamily: C.mono, fontWeight: 700 }}>{statusText}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {failing.length > 0 && (
            <div style={{ background: C.redDim, border: `1px solid ${C.red}25`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: C.red, fontWeight: 700, fontFamily: C.mono, marginBottom: 8 }}>FAILING SIGNALS</div>
              {failing.map((f, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 3 }}>
                  <span>{f.catLabel} · {f.sigLabel}</span>
                  <span style={{ fontFamily: C.mono, color: C.red }}>{fmtVal({ direction: f.direction, unit: f.unit }, f.value)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, color: C.dim, textAlign: "center", fontFamily: C.mono }}>
            Generated by Verdikt · useverdikt.com · Release Intelligence System
          </div>

          <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 10, background: `${C.accent}08`, border: `1px solid ${C.accent}20` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 700, fontFamily: C.mono, letterSpacing: "0.1em", color: C.accentBright, background: `${C.accent}20`, padding: "2px 7px", borderRadius: 4 }}>AI SUMMARY</div>
              <div style={{ fontSize: 9, color: C.dim, fontFamily: C.mono }}>Generated · ready to forward</div>
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
              {genCertSummary(release, failing, isShip)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
