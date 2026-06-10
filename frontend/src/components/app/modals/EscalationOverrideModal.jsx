import React, { useEffect, useState } from "react";
import { C } from "../../../theme/tokens.js";

function useModalLayer(onClose) {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
}

export default function EscalationOverrideModal({ row, currentUser, onClose, onConfirm, busy }) {
  useModalLayer(onClose);
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 900;
  const [justification, setJustification] = useState("");
  const [impactSummary, setImpactSummary] = useState("");
  const [mitigationPlan, setMitigationPlan] = useState("");
  const [followUpDate, setFollowUpDate] = useState(() =>
    new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
  );

  const ownerLabel = currentUser?.name
    ? `${currentUser.name}${currentUser.role ? ` (${currentUser.role.replace(/_/g, " ")})` : ""}`
    : "Approver";
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(followUpDate);
  const can =
    justification.trim().length > 20 &&
    impactSummary.trim().length >= 8 &&
    mitigationPlan.trim().length >= 8 &&
    dateOk &&
    !busy;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000000d8",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: isMobile ? 10 : 20,
        backdropFilter: "blur(4px)"
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="scale-in"
        style={{
          background: C.raise,
          border: `1px solid ${C.borderL}`,
          borderRadius: isMobile ? 12 : 18,
          padding: isMobile ? 16 : 28,
          maxWidth: 560,
          width: "100%",
          boxShadow: "0 32px 100px #00000090",
          maxHeight: isMobile ? "96vh" : "90vh",
          overflowY: "auto"
        }}
      >
        <div
          style={{
            color: C.amber,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            fontFamily: C.mono,
            marginBottom: 8
          }}
        >
          ESCALATION — {row.release_version || row.release_id}
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: C.text }}>Acknowledge & Override</h3>
        <p style={{ margin: "0 0 16px", color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
          Resolve this escalation and certify with override in one step. Your name and justification are permanent.
        </p>
        {row.blocking_signals?.length ? (
          <div
            style={{
              background: C.redDim,
              border: `1px solid ${C.red}25`,
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 16,
              fontFamily: C.mono,
              fontSize: 11,
              color: C.amber
            }}
          >
            Blocking: {row.blocking_signals.join(", ")}
          </div>
        ) : null}
        <div style={{ marginBottom: 12, fontFamily: C.mono, fontSize: 11, color: C.dim }}>
          Override owner: <span style={{ color: C.amber }}>{ownerLabel}</span>
        </div>
        <label style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, fontFamily: C.mono }}>
          JUSTIFICATION *
        </label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={3}
          placeholder="Why ship despite blocked signals? Risk acceptance and owner commitments."
          style={{
            width: "100%",
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "10px 14px",
            color: C.text,
            fontSize: 13,
            marginBottom: 12,
            boxSizing: "border-box",
            resize: "vertical"
          }}
        />
        <label style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, fontFamily: C.mono }}>
          IMPACT SUMMARY *
        </label>
        <textarea
          value={impactSummary}
          onChange={(e) => setImpactSummary(e.target.value)}
          rows={2}
          placeholder="Who is affected and how severely?"
          style={{
            width: "100%",
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "10px 14px",
            color: C.text,
            fontSize: 13,
            marginBottom: 12,
            boxSizing: "border-box",
            resize: "vertical"
          }}
        />
        <label style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, fontFamily: C.mono }}>
          MITIGATION PLAN *
        </label>
        <textarea
          value={mitigationPlan}
          onChange={(e) => setMitigationPlan(e.target.value)}
          rows={2}
          placeholder="Rollback plan, monitoring, owner, timeline"
          style={{
            width: "100%",
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "10px 14px",
            color: C.text,
            fontSize: 13,
            marginBottom: 12,
            boxSizing: "border-box",
            resize: "vertical"
          }}
        />
        <label style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, fontFamily: C.mono }}>
          FOLLOW-UP DUE DATE *
        </label>
        <input
          type="date"
          value={followUpDate}
          onChange={(e) => setFollowUpDate(e.target.value)}
          style={{
            width: "100%",
            maxWidth: 280,
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "10px 14px",
            color: C.text,
            fontSize: 13,
            fontFamily: C.mono,
            marginBottom: 16,
            boxSizing: "border-box"
          }}
        />
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!can}
            onClick={() =>
              can &&
              onConfirm({
                justification: justification.trim(),
                metadata: {
                  impact_summary: impactSummary.trim(),
                  mitigation_plan: mitigationPlan.trim(),
                  follow_up_due_date: followUpDate
                }
              })
            }
          >
            {busy ? "Submitting…" : "Acknowledge & Override"}
          </button>
        </div>
      </div>
    </div>
  );
}
