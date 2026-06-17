import React, { useEffect, useMemo, useState } from "react";
import { C } from "../../../theme/tokens.js";
import { apiGet } from "../../../lib/apiClient.js";

function AuditIntegrityBadge({ wsId, wsReady }) {
  const [integrity, setIntegrity] = useState(null);

  useEffect(() => {
    if (!wsReady || !wsId) return;
    let cancelled = false;
    void apiGet(`/api/workspaces/${wsId}/audit/integrity`)
      .then((data) => {
        if (!cancelled) setIntegrity(data);
      })
      .catch(() => {
        if (!cancelled) setIntegrity(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wsId, wsReady]);

  if (!wsReady || !integrity) return null;

  const issueCount =
    (integrity.tampered?.length || 0) +
    (integrity.broken_chain?.length || 0) +
    (integrity.missing_hash?.length || 0);
  const ok = integrity.valid !== false && issueCount === 0;
  const verified = Number(integrity.ok || 0);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        marginTop: 10,
        padding: "6px 10px",
        borderRadius: 8,
        border: `1px solid ${ok ? C.green + "44" : C.red + "44"}`,
        background: ok ? C.green + "12" : C.red + "12",
        fontFamily: C.mono,
        fontSize: 11,
        color: ok ? C.green : C.red
      }}
    >
      <span>{ok ? "✓" : "!"}</span>
      <span>
        {ok
          ? `Audit integrity verified (${verified} events)`
          : `Integrity alert — ${issueCount} issue${issueCount === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

function AuditSkeletonRows({ count = 6, isMobile }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          style={{
            padding: isMobile ? "12px 12px" : "14px 18px",
            borderBottom: i < count - 1 ? `1px solid ${C.border}` : "none",
            display: "grid",
            gridTemplateColumns: isMobile ? "8px 1fr" : "8px 130px 1fr auto",
            gap: 14,
            alignItems: "flex-start"
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(255,255,255,0.06)", marginTop: 4 }} />
          {!isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ height: 10, width: 72, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ height: 10, width: 48, borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ height: 12, width: "55%", borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ height: 10, width: "85%", borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ height: 10, width: "40%", borderRadius: 4, background: "rgba(255,255,255,0.06)" }} />
          </div>
        </div>
      ))}
    </>
  );
}

export default function AuditView({
  auditLog,
  releases,
  isMobile,
  wsReady = true,
  wsId,
  hasMoreAudit = false,
  loadingMoreAudit = false,
  onLoadMoreAudit,
  onSelectRelease
}) {
  const releaseLookup = useMemo(() => {
    const byBackendId = new Map();
    const byVersion = new Map();
    for (const r of releases || []) {
      if (r.backendReleaseId) byBackendId.set(r.backendReleaseId, r);
      if (r.version) byVersion.set(r.version, r);
    }
    return { byBackendId, byVersion };
  }, [releases]);

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontFamily: C.mono, fontSize: 10, letterSpacing: "0.11em", textTransform: "uppercase", color: C.dim, marginBottom: 6 }}>Governance</div>
        <h2 style={{ margin: 0, fontFamily: C.serif, fontSize: 28, fontWeight: 600, color: C.text, letterSpacing: "-0.01em", lineHeight: 1.1 }}>Audit Trail</h2>
        <p style={{ margin: "8px 0 0", color: C.muted, fontSize: 13 }}>
          Immutable quality record. Every verdict, override, waiver, and release decision — permanently on record. Click any release-linked entry to view its full certification record.
        </p>
        <AuditIntegrityBadge wsId={wsId} wsReady={wsReady} />
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "8px 1fr" : "8px 130px 1fr auto", gap: 14, padding: isMobile ? "8px 12px" : "10px 18px", borderBottom: `1px solid ${C.border}`, fontFamily: C.mono, fontSize: 9.5, letterSpacing: "0.09em", textTransform: "uppercase", color: C.dim, background: C.raise }}>
          <div />
          {!isMobile ? <div>Time</div> : null}
          <div>Event</div>
          {!isMobile ? <div style={{ textAlign: "right" }}>Record</div> : null}
        </div>
        {!wsReady ? (
          <AuditSkeletonRows isMobile={isMobile} />
        ) : auditLog.length === 0 ? (
          <div style={{ padding: "32px 18px", textAlign: "center", color: C.dim, fontFamily: C.mono, fontSize: 12 }}>
            No audit events yet for this workspace.
          </div>
        ) : (
          auditLog.map((entry, i) => {
            const evKey = String(entry._rawEventType || entry.event || "").toLowerCase().replace(/ /g, "_");
            const isUncert = evKey.includes("uncertified");
            const isOv = evKey.includes("override");
            const isBlk = evKey.includes("block") || isUncert;
            const isSh = !isUncert && (evKey.includes("shipped") || evKey.includes("certified"));
            const isWv = evKey.includes("waived");
            const dot = isWv ? C.amber : isOv ? C.amber : isBlk ? C.red : isSh ? C.green : C.accent;
            const linkedRelease = entry.backendReleaseId
              ? releaseLookup.byBackendId.get(entry.backendReleaseId)
              : releaseLookup.byVersion.get(entry.release);
            const canOpenRecord = !!linkedRelease || !!entry.backendReleaseId;
            const releaseBadge = linkedRelease?.version || entry.release;
            return (
              <div
                key={entry.id}
                onClick={canOpenRecord ? () => onSelectRelease(linkedRelease || null, entry.backendReleaseId || null) : undefined}
                style={{
                  padding: isMobile ? "12px 12px" : "14px 18px",
                  borderBottom: i < auditLog.length - 1 ? `1px solid ${C.border}` : "none",
                  display: "grid",
                  gridTemplateColumns: isMobile ? "8px 1fr" : "8px 130px 1fr auto",
                  gap: 14,
                  alignItems: "flex-start",
                  cursor: canOpenRecord ? "pointer" : "default",
                  transition: "background 0.15s"
                }}
                onMouseEnter={canOpenRecord ? (e) => (e.currentTarget.style.background = C.raise) : undefined}
                onMouseLeave={canOpenRecord ? (e) => (e.currentTarget.style.background = "transparent") : undefined}
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
                {canOpenRecord ? (
                  <div style={{ display: "flex", alignItems: "flex-start", paddingTop: 2, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, fontWeight: 700, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>VIEW RECORD →</span>
                  </div>
                ) : (
                  <div />
                )}
              </div>
            );
          })
        )}
        {hasMoreAudit ? (
          <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.border}`, textAlign: "center" }}>
            <button
              type="button"
              onClick={() => onLoadMoreAudit?.()}
              disabled={loadingMoreAudit}
              style={{
                fontFamily: C.mono,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: C.accent,
                background: "transparent",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "8px 14px",
                cursor: loadingMoreAudit ? "wait" : "pointer",
                opacity: loadingMoreAudit ? 0.7 : 1
              }}
            >
              {loadingMoreAudit ? "Loading…" : "Load older events"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
