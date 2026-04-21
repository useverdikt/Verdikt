import React from "react";
import { C } from "../../../theme/tokens.js";

export default function AuditView({ auditLog, releases, isMobile, onSelectRelease }) {
  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontFamily: C.mono, fontSize: 10, letterSpacing: "0.11em", textTransform: "uppercase", color: C.dim, marginBottom: 6 }}>Governance</div>
        <h2 style={{ margin: 0, fontFamily: C.serif, fontSize: 28, fontWeight: 600, color: C.text, letterSpacing: "-0.01em", lineHeight: 1.1 }}>Audit Trail</h2>
        <p style={{ margin: "8px 0 0", color: C.muted, fontSize: 13 }}>
          Immutable quality record. Every verdict, override, waiver, and release decision — permanently on record. Click any entry to view its full certification record.
        </p>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "8px 1fr" : "8px 130px 1fr auto", gap: 14, padding: isMobile ? "8px 12px" : "10px 18px", borderBottom: `1px solid ${C.border}`, fontFamily: C.mono, fontSize: 9.5, letterSpacing: "0.09em", textTransform: "uppercase", color: C.dim, background: C.raise }}>
          <div />
          {!isMobile ? <div>Time</div> : null}
          <div>Event</div>
          {!isMobile ? <div style={{ textAlign: "right" }}>Record</div> : null}
        </div>
        {auditLog.map((entry, i) => {
          const evKey = String(entry._rawEventType || entry.event || "").toLowerCase().replace(/ /g, "_");
          const isUncert = evKey.includes("uncertified");
          const isOv = evKey.includes("override");
          const isBlk = evKey.includes("block") || isUncert;
          const isSh = !isUncert && (evKey.includes("shipped") || evKey.includes("certified"));
          const isWv = evKey.includes("waived");
          const dot = isWv ? C.amber : isOv ? C.amber : isBlk ? C.red : isSh ? C.green : C.accent;
          const linkedRelease = entry.backendReleaseId
            ? releases.find((r) => r.backendReleaseId === entry.backendReleaseId)
            : releases.find((r) => r.version === entry.release);
          const releaseBadge = linkedRelease?.version || entry.release;
          return (
            <div
              key={entry.id}
              onClick={linkedRelease ? () => onSelectRelease(linkedRelease) : undefined}
              style={{
                padding: isMobile ? "12px 12px" : "14px 18px",
                borderBottom: i < auditLog.length - 1 ? `1px solid ${C.border}` : "none",
                display: "grid",
                gridTemplateColumns: isMobile ? "8px 1fr" : "8px 130px 1fr auto",
                gap: 14,
                alignItems: "flex-start",
                cursor: linkedRelease ? "pointer" : "default",
                transition: "background 0.15s"
              }}
              onMouseEnter={linkedRelease ? (e) => (e.currentTarget.style.background = C.raise) : undefined}
              onMouseLeave={linkedRelease ? (e) => (e.currentTarget.style.background = "transparent") : undefined}
            >
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: dot, marginTop: 4, boxShadow: `0 0 6px ${dot}66` }} />
              <div style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, lineHeight: 1.8 }}>
                <div>{entry.ts.split(" ")[0]}</div>
                <div>{entry.ts.split(" ")[1]}</div>
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                  <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{entry.event}</span>
                  <span style={{ fontFamily: C.mono, fontSize: 10, color: C.accent, background: C.accentDim, padding: "1px 7px", borderRadius: 4 }}>{releaseBadge}</span>
                </div>
                <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.6 }}>{entry.detail}</div>
                <div style={{ color: C.dim, fontSize: 11, marginTop: 3, fontFamily: C.mono }}>by {entry.actor}</div>
              </div>
              {linkedRelease ? (
                <div style={{ display: "flex", alignItems: "flex-start", paddingTop: 2, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, fontWeight: 700, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>VIEW RECORD →</span>
                </div>
              ) : (
                <div />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
