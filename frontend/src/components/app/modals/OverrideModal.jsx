import React, { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../../../theme/tokens.js";
import { Btn } from "../../ui/Btn.jsx";

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

export default function OverrideModal({
  release,
  thresholds,
  currentUser,
  onClose,
  onConfirm,
  roles,
  calcVerdict,
  fmtVal,
  buildRegressionOverrideContext,
  findSignalMetaById,
  formatAiPct,
  scoreJustification
}) {
  const titleId = React.useId();
  useModalLayer(onClose);
  const isMobile = window.innerWidth <= 900;
  const regCtx = useMemo(() => buildRegressionOverrideContext(release.release_deltas), [release.release_deltas, buildRegressionOverrideContext]);
  const [reason, setReason] = useState("");
  const [impactSummary, setImpactSummary] = useState("");
  const [mitigationPlan, setMitigationPlan] = useState("");
  const [followUpDate, setFollowUpDate] = useState(() => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));

  useEffect(() => {
    const next = buildRegressionOverrideContext(release.release_deltas);
    if (!next.justification) return;
    setReason((prev) => (String(prev).trim().length === 0 ? next.justification : prev));
    setImpactSummary((prev) => (String(prev).trim().length === 0 ? next.suggestedImpact : prev));
  }, [release.release_deltas, buildRegressionOverrideContext]);

  const ownerLabel = currentUser ? `${currentUser.name}, ${roles[currentUser.role]?.title || "User"}` : "";
  const { failing } = useMemo(() => calcVerdict(release.signals, thresholds, release.releaseType), [release.signals, release.releaseType, thresholds, calcVerdict]);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(followUpDate);
  const can = reason.length > 20 && impactSummary.length >= 8 && mitigationPlan.length >= 8 && dateOk;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000d8", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: isMobile ? 10 : 20, backdropFilter: "blur(4px)" }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="scale-in" style={{ background: C.raise, border: `1px solid ${C.borderL}`, borderRadius: isMobile ? 12 : 18, padding: isMobile ? 16 : 32, maxWidth: regCtx.regressionRows.length ? 620 : 560, width: "100%", boxShadow: "0 32px 100px #00000090", maxHeight: isMobile ? "96vh" : "90vh", overflowY: "auto" }}>
        <div style={{ color: C.amber, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", fontFamily: C.mono, marginBottom: 8 }}>OVERRIDE REQUEST — {release.version}</div>
        <h3 id={titleId} style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 800, color: C.text }}>Ship UNCERTIFIED — Override Required</h3>
        <p style={{ margin: "0 0 20px", color: C.muted, fontSize: 13, lineHeight: 1.7 }}>
          This release is UNCERTIFIED. If it ships, it ships as CERTIFIED WITH OVERRIDE - not as certified, not anonymously. The named owner and written justification are permanent and immutable.
        </p>
        <div style={{ background: C.redDim, border: `1px solid ${C.red}25`, borderRadius: 8, padding: "13px 16px", marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: C.red, fontWeight: 700, marginBottom: 8, letterSpacing: "0.1em", fontFamily: C.mono }}>FAILING SIGNALS ({failing.length})</div>
          {failing.map((f, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 4, gap: 12 }}>
              <span style={{ color: C.text }}>{f.catLabel} · {f.sigLabel}</span>
              <span style={{ fontFamily: C.mono, color: C.red, flexShrink: 0 }}>
                {fmtVal({ direction: f.direction, unit: f.unit }, f.value)} <span style={{ color: C.dim }}>vs {f.direction === "above" ? "≥" : "≤"}{f.threshold}{f.unit}</span>
              </span>
            </div>
          ))}
        </div>
        {regCtx.regressionRows.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.amber, fontWeight: 700, marginBottom: 10, letterSpacing: "0.1em", fontFamily: C.mono }}>REGRESSION DETECTED (vs last certified)</div>
            {regCtx.regressionRows.map((d, ri) => (
              <div key={d.signal_id || ri} style={{ marginBottom: ri < regCtx.regressionRows.length - 1 ? 12 : 0, padding: "10px 12px", borderRadius: 8, background: C.amberDim, border: `1px solid ${C.amber}30` }}>
                <div style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 8 }}>{findSignalMetaById(d.signal_id)?.label || d.signal_id}</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 11, fontFamily: C.mono, color: C.muted }}>
                  <div><div style={{ fontSize: 9, color: C.dim, marginBottom: 3, letterSpacing: "0.06em" }}>BASELINE RELEASE</div><div style={{ color: C.text, fontWeight: 600 }}>{d.baseline_version || (d.baseline_release_id ? "…" + String(d.baseline_release_id).slice(-8) : "—")}</div></div>
                  <div><div style={{ fontSize: 9, color: C.dim, marginBottom: 3, letterSpacing: "0.06em" }}>BASELINE</div><div style={{ color: C.text, fontWeight: 600 }}>{formatAiPct(d.baseline_value)}</div></div>
                  <div><div style={{ fontSize: 9, color: C.dim, marginBottom: 3, letterSpacing: "0.06em" }}>CURRENT</div><div style={{ color: C.text, fontWeight: 600 }}>{formatAiPct(d.current_value)}</div></div>
                  <div><div style={{ fontSize: 9, color: C.dim, marginBottom: 3, letterSpacing: "0.06em" }}>ALLOWED / ACTUAL DROP</div><div style={{ color: C.text, fontWeight: 600 }}>≤ {d.max_allowed_drop} / {d.drop_amount != null ? Number(d.drop_amount).toFixed(1) : "—"}</div></div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 6, letterSpacing: "0.1em", fontFamily: C.mono }}>OVERRIDE OWNER</label>
          <div style={{ background: C.surface, border: `1px solid ${C.amber}40`, borderRadius: 7, padding: "9px 13px", color: C.amber, fontSize: 13, fontWeight: 700, fontFamily: C.mono, letterSpacing: "0.02em" }}>{ownerLabel}</div>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 4, fontFamily: C.mono }}>Signed at your role level. Cannot be changed.</div>
        </div>
        <div style={{ marginBottom: 22 }}>
          <label style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, letterSpacing: "0.1em", fontFamily: C.mono }}>JUSTIFICATION & RISK ACCEPTANCE{regCtx.regressionRows.length ? " (pre-filled from regression data)" : ""}</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder={regCtx.regressionRows.length ? "Edit or expand the pre-filled regression summary - add impact, risk acceptance, and owner commitments." : "Why should this ship below threshold? What is the user impact? What mitigations are committed to?"} style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", color: C.text, fontSize: 13, outline: "none", resize: "vertical", lineHeight: 1.7, boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, letterSpacing: "0.1em", fontFamily: C.mono }}>IMPACT SUMMARY *</label>
          <textarea value={impactSummary} onChange={(e) => setImpactSummary(e.target.value)} rows={2} placeholder="Who is affected and how severely? (min 8 characters)" style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", color: C.text, fontSize: 13, outline: "none", resize: "vertical", lineHeight: 1.6, boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, letterSpacing: "0.1em", fontFamily: C.mono }}>MITIGATION PLAN *</label>
          <textarea value={mitigationPlan} onChange={(e) => setMitigationPlan(e.target.value)} rows={2} placeholder="Rollback plan, monitoring, owner, timeline (min 8 characters)" style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", color: C.text, fontSize: 13, outline: "none", resize: "vertical", lineHeight: 1.6, boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 5, letterSpacing: "0.1em", fontFamily: C.mono }}>FOLLOW-UP DUE DATE *</label>
          <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} style={{ width: "100%", maxWidth: 280, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", color: C.text, fontSize: 13, fontFamily: C.mono, boxSizing: "border-box" }} />
          {!dateOk && followUpDate ? <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>Use a valid calendar date.</div> : null}
        </div>
        {reason.length > 15 ? (() => {
          const s = scoreJustification(reason);
          return <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 13px", borderRadius: 8, border: `1px solid ${s.color}25`, background: `${s.color}08`, marginBottom: 16 }}><div style={{ fontSize: 9, fontWeight: 700, fontFamily: C.mono, letterSpacing: "0.1em", padding: "2px 7px", borderRadius: 4, background: `${s.color}20`, color: s.color, flexShrink: 0, marginTop: 1 }}>AI · {s.grade}</div><div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{s.note}</div></div>;
        })() : null}
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="amber" onClick={() => can && onConfirm(ownerLabel, { justification: reason, impact_summary: impactSummary, mitigation_plan: mitigationPlan, follow_up_due_date: followUpDate })} disabled={!can}>Confirm Override & Ship</Btn>
        </div>
      </div>
    </div>
  );
}
