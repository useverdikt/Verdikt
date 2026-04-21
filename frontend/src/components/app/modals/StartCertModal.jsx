import React, { useEffect, useRef, useState } from "react";
import { C } from "../../../theme/tokens.js";

const isMobileViewport = () => window.innerWidth <= 900;

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

export default function StartCertModal({ onClose, onStart, releaseTypes }) {
  const titleId = React.useId();
  useModalLayer(onClose);
  const isMobile = isMobileViewport();
  const [version, setVersion] = useState("");
  const [buildRef, setBuildRef] = useState("");
  const [relType, setRelType] = useState("prompt_update");
  const can = version.trim().length > 1;
  const inputStyle = {
    width: "100%",
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 14px",
    color: C.text,
    fontSize: 13,
    fontFamily: C.mono,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s"
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "#000000d8", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: isMobile ? 10 : 20 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: isMobile ? 12 : 16, padding: isMobile ? "16px 12px" : "32px 36px", width: "100%", maxWidth: 480, maxHeight: isMobile ? "96vh" : "90vh", overflowY: "auto", position: "relative" }}>
        <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 16, right: 18, background: "transparent", border: "none", color: C.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
        <div style={{ fontFamily: C.mono, fontSize: 10, color: C.accent, letterSpacing: "0.12em", marginBottom: 8 }}>NEW CERTIFICATION SESSION</div>
        <h3 id={titleId} style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: "-0.03em" }}>Start certification</h3>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: C.muted, lineHeight: 1.65 }}>
          Verdikt will open a signal collection window. Connected sources will report signals automatically - or simulate arrival below for demo.
        </p>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontFamily: C.mono, fontSize: 10, color: C.muted, letterSpacing: "0.08em", marginBottom: 6 }}>VERSION *</label>
          <input type="text" placeholder="e.g. v2.15.0" value={version} onChange={(e) => setVersion(e.target.value)} style={inputStyle} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontFamily: C.mono, fontSize: 10, color: C.muted, letterSpacing: "0.08em", marginBottom: 6 }}>BUILD REFERENCE</label>
          <input type="text" placeholder="e.g. build/3162-uat-mobile" value={buildRef} onChange={(e) => setBuildRef(e.target.value)} style={inputStyle} />
          <div style={{ marginTop: 4, fontSize: 11, color: C.dim }}>The build identifier used in your connected signal sources.</div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontFamily: C.mono, fontSize: 10, color: C.muted, letterSpacing: "0.08em", marginBottom: 8 }}>RELEASE TYPE</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {releaseTypes.map((rt) => (
              <button
                key={rt.id}
                onClick={() => setRelType(rt.id)}
                style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${relType === rt.id ? C.accent : C.border}`, background: relType === rt.id ? C.accentDim : "transparent", color: relType === rt.id ? C.accentBright : C.muted, fontSize: 11, fontFamily: C.mono, cursor: "pointer" }}
              >
                {rt.icon} {rt.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 13, cursor: "pointer", fontFamily: C.mono }}>Cancel</button>
          <button
            onClick={() => can && onStart({ version: version.trim(), buildRef: buildRef.trim(), relType })}
            style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: can ? C.accent : C.border, color: can ? "#fff" : C.dim, fontSize: 13, fontWeight: 700, cursor: can ? "pointer" : "not-allowed", fontFamily: C.mono }}
          >
            Start certification →
          </button>
        </div>
      </div>
    </div>
  );
}
