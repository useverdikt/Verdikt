import React, { useState, useEffect } from "react";
import { C, T } from "../../theme/tokens.js";
import { Btn } from "../ui/Btn.jsx";

function buildDecisionCompactLine({
  verdictIntel,
  overrideIntel,
  decisionIntel,
  outcomeIntel
}) {
  const bits = [];
  if (verdictIntel?.risk_level || verdictIntel?.summary) {
    const r = verdictIntel.risk_level || "N/A";
    const s = verdictIntel.summary ? String(verdictIntel.summary) : "";
    bits.push(
      s
        ? `Risk ${r} · ${s.length > 90 ? `${s.slice(0, 90)}…` : s}`
        : `Risk ${r}`
    );
  }
  if (overrideIntel)
    bits.push(`Override quality: ${overrideIntel.quality || "N/A"}`);
  if (decisionIntel) bits.push(`Decision: ${decisionIntel.decision}`);
  if (outcomeIntel) bits.push(`Outcome: ${outcomeIntel.label}`);
  return bits.join(" · ") || "Intelligence summary available — expand for full details.";
}

export function DecisionSignalsCollapsible({
  releaseKey,
  verdictSourceUi,
  decisionSourceDetailsOpen,
  setDecisionSourceDetailsOpen,
  verdictIntel,
  overrideIntel,
  decisionIntel,
  outcomeIntel,
  onIntelligenceDecision,
  onIntelligenceOutcome,
  showIntelligenceActions
}) {
  const [panelExpanded, setPanelExpanded] = useState(false);

  useEffect(() => {
    setPanelExpanded(false);
  }, [releaseKey]);

  const compactLine = buildDecisionCompactLine({
    verdictIntel,
    overrideIntel,
    decisionIntel,
    outcomeIntel
  });

  const shellStyle = {
    marginTop: 4,
    borderRadius: 16,
    border: `1px solid ${C.glassBorder}`,
    background: C.glassBg,
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    boxShadow: C.elevShadow,
    overflow: "hidden"
  };

  if (!panelExpanded) {
    return (
      <section style={shellStyle} aria-label="Decision signals summary">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 18px"
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 12rem" }}>
            <div
              style={{
                ...T.sectionHeading,
                letterSpacing: "0.06em",
                marginBottom: 6
              }}
            >
              Decision signals
            </div>
            <div
              style={{
                ...T.releaseMeta,
                color: C.muted,
                lineHeight: 1.55
              }}
            >
              {compactLine}
            </div>
          </div>
          <button
            type="button"
            className="sidebar-bulk-btn"
            onClick={() => setPanelExpanded(true)}
            aria-expanded={false}
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontFamily: C.mono,
              fontWeight: 700,
              padding: "8px 14px",
              borderRadius: 10,
              border: `1px solid ${C.accent}45`,
              background: C.accentDim,
              color: C.accentBright,
              cursor: "pointer"
            }}
          >
            Expand
          </button>
        </div>
      </section>
    );
  }

  return (
    <div
      style={{
        background: C.glassBg,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${C.glassBorder}`,
        borderRadius: 16,
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: C.elevShadow
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 2
        }}
      >
        <div
          style={{
            color: C.accentBright,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.12em",
            fontFamily: C.mono
          }}
        >
          DECISION SIGNALS
        </div>
        <button
          type="button"
          className="sidebar-bulk-btn"
          onClick={() => setPanelExpanded(false)}
          style={{
            fontSize: 10,
            fontFamily: C.mono,
            fontWeight: 700,
            padding: "5px 10px",
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            background: "transparent",
            color: C.muted,
            cursor: "pointer"
          }}
        >
          Minimize
        </button>
      </div>

      {verdictSourceUi && (
        <div
          style={{
            color: "rgba(241, 243, 249, 0.82)",
            fontSize: 11,
            fontFamily: C.mono,
            fontWeight: 600,
            letterSpacing: "0.06em",
            marginBottom: 4
          }}
        >
          {verdictSourceUi.label}
        </div>
      )}
      {verdictSourceUi && (
        <div style={{ marginBottom: 6, maxWidth: 560 }}>
          <div
            style={{
              color: "rgba(241, 243, 249, 0.9)",
              fontSize: 13,
              lineHeight: 1.5,
              fontFamily: C.sans,
              overflowWrap: "break-word"
            }}
          >
            {verdictSourceUi.shortLine}
          </div>
          <button
            type="button"
            onClick={() => setDecisionSourceDetailsOpen((v) => !v)}
            aria-expanded={decisionSourceDetailsOpen}
            style={{
              marginTop: 8,
              background: "transparent",
              border: "none",
              padding: 0,
              color: C.accentBright,
              fontSize: 11,
              fontFamily: C.mono,
              fontWeight: 700,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3
            }}
          >
            {decisionSourceDetailsOpen ? "Hide source details" : "Source details"}
          </button>
          {decisionSourceDetailsOpen ? (
            <div
              style={{
                color: "rgba(241, 243, 249, 0.88)",
                fontSize: 13,
                lineHeight: 1.58,
                marginTop: 10,
                fontFamily: C.sans,
                overflowWrap: "break-word",
                borderLeft: `2px solid ${C.borderL}`,
                paddingLeft: 12
              }}
            >
              {verdictSourceUi.hint}
            </div>
          ) : null}
        </div>
      )}
      {verdictIntel && (
        <div style={{ color: C.text, fontSize: 13, lineHeight: 1.7 }}>
          <strong>Risk: {verdictIntel.risk_level || "N/A"}</strong> ·{" "}
          {verdictIntel.summary || ""}
        </div>
      )}
      {Array.isArray(verdictIntel?.recommended_actions) &&
        verdictIntel.recommended_actions.length > 0 && (
          <div style={{ color: C.muted, fontSize: 12 }}>
            Actions: {verdictIntel.recommended_actions.join(" | ")}
          </div>
        )}
      {overrideIntel && (
        <div style={{ color: C.text, fontSize: 12 }}>
          Override quality:{" "}
          <strong>{overrideIntel.quality || "N/A"}</strong>
          {overrideIntel?.score !== undefined ? ` (${overrideIntel.score})` : ""}
        </div>
      )}
      {(decisionIntel || outcomeIntel) && (
        <div
          style={{ color: C.muted, fontSize: 11, fontFamily: C.mono }}
        >
          {decisionIntel ? `Decision: ${decisionIntel.decision}` : "Decision: -"} ·{" "}
          {outcomeIntel ? `Outcome: ${outcomeIntel.label}` : "Outcome: -"}
        </div>
      )}
      {showIntelligenceActions && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn onClick={() => onIntelligenceDecision("applied")}>Mark Applied</Btn>
          <Btn onClick={() => onIntelligenceDecision("dismissed")} variant="ghost">
            Mark Dismissed
          </Btn>
          <Btn onClick={() => onIntelligenceDecision("shipped")} variant="ghost">
            Mark Shipped
          </Btn>
          <Btn
            onClick={() => onIntelligenceOutcome("no_incident")}
            variant="ghost"
          >
            Outcome: No Incident
          </Btn>
          <Btn onClick={() => onIntelligenceOutcome("incident")} variant="ghost">
            Outcome: Incident
          </Btn>
          <Btn
            onClick={() => onIntelligenceOutcome("followup_met")}
            variant="ghost"
          >
            Outcome: Follow-up Met
          </Btn>
        </div>
      )}
    </div>
  );
}
