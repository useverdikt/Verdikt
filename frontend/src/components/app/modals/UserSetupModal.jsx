import React, { useEffect, useState } from "react";
import { C } from "../../../theme/tokens.js";
import { Btn } from "../../ui/Btn.jsx";
import { Inp, Logo } from "../CommonControls.jsx";

export default function UserSetupModal({ onSave, roles }) {
  const titleId = React.useId();
  const isMobile = window.innerWidth <= 900;
  const [name, setName] = useState("");
  const [role, setRole] = useState("ai_product_lead");
  const can = name.trim().length > 1;

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const roleDescriptions = {
    ai_product_lead: "Primary user for AI product teams. Defines quality thresholds and certifies releases. Override authority is configurable per workspace.",
    ml_engineer: "Submits model updates and prompt changes for certification. Can view all eval signals and certification status per release.",
    engineer: "Read-only access. Can view all certification records, signal data, and the audit trail - but cannot certify, override, add releases, or manage projects.",
    qe_lead: "Can certify releases and waive signals. Override authority is configurable per workspace.",
    tech_lead: "Can certify releases and manage release readiness. Override authority is configurable per workspace settings.",
    release_manager: "Can certify releases and coordinate ship decisions. Override authority is configurable per workspace settings.",
    vp_engineering: "Can certify releases and approve overrides. Your name is permanently on record for every override you authorise.",
    cto: "Full access. Override authority at the highest level. Every override is signed at CTO / Founder."
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000000f0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 500,
        padding: isMobile ? 10 : 20,
        backdropFilter: "blur(8px)"
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="scale-in"
        style={{
          background: C.raise,
          border: `1px solid ${C.borderL}`,
          borderRadius: isMobile ? 12 : 18,
          padding: isMobile ? 16 : 32,
          maxWidth: 480,
          width: "100%",
          boxShadow: "0 32px 100px #00000090",
          maxHeight: isMobile ? "96vh" : "90vh",
          overflowY: "auto"
        }}
      >
        <Logo />

        <div style={{ marginTop: 24, marginBottom: 4 }}>
          <div style={{ color: C.accent, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", fontFamily: C.mono, marginBottom: 6 }}>BEFORE YOU BEGIN</div>
          <h3 id={titleId} style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: "0 0 8px" }}>Who are you?</h3>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.75, margin: "0 0 22px" }}>
            Your name and role are permanently attached to every certification decision, override, and waiver you make. This is how accountability works.
          </p>
        </div>

        <Inp label="YOUR NAME" value={name} onChange={setName} placeholder="e.g. Jordan Blake" />

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 10, letterSpacing: "0.1em", fontFamily: C.mono }}>YOUR ROLE</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(roles).map(([id, r]) => {
              const active = role === id;
              const desc = roleDescriptions[id];
              return (
                <button
                  key={id}
                  onClick={() => setRole(id)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 14,
                    padding: "14px 16px",
                    borderRadius: 10,
                    border: `1px solid ${active ? r.color : C.border}`,
                    background: active ? `${r.color}12` : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s"
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: active ? r.color : C.dim, flexShrink: 0, marginTop: 5, boxShadow: active ? `0 0 8px ${r.color}66` : "" }} />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: active ? r.color : C.text }}>{r.label}</span>
                      {id === "engineer" && (
                        <span style={{ fontSize: 9, fontFamily: C.mono, color: C.muted, background: C.border, padding: "1px 6px", borderRadius: 3, fontWeight: 700, letterSpacing: "0.06em" }}>
                          READ ONLY
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>{desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <Btn
          variant="primary"
          onClick={() => can && onSave({ name: name.trim(), role })}
          disabled={!can}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {can ? `Enter as ${name} · ${roles[role].title}` : "Enter your name to continue"}
        </Btn>
      </div>
    </div>
  );
}
