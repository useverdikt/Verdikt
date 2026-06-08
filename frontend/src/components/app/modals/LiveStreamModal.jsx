import React, { useEffect } from "react";
import { C } from "../../../theme/tokens.js";
import { useReleaseStream } from "../../../lib/useReleaseStream.js";

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

function formatEventTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return String(ts);
  }
}

function eventLabel(ev) {
  if (ev.type === "verdict") return `Verdict · ${ev.status || "issued"}`;
  if (ev.type === "deadline_extended") return `Deadline extended +${ev.extend_minutes ?? "?"}m`;
  if (ev.type === "signal_progress") {
    const missing = ev.missing_required;
    return missing != null ? `Signals · ${missing} required remaining` : "Signal progress";
  }
  return ev.type || "event";
}

export default function LiveStreamModal({ release, onClose }) {
  const titleId = React.useId();
  useModalLayer(onClose);
  const backendId = release?.backendReleaseId || release?.id;
  const { events, status, earlyWarning, error, collectionDeadline } = useReleaseStream(backendId, !!backendId);

  const statusLabel =
    status === "connected"
      ? "Connected"
      : status === "collecting"
        ? "Collecting"
        : status === "verdict_issued"
          ? "Verdict issued"
          : status === "closed"
            ? "Stream closed"
            : error
              ? "Disconnected"
              : "Connecting…";

  const statusColor =
    status === "verdict_issued" ? C.green : error ? C.red : status === "connected" || status === "collecting" ? C.accent : C.muted;

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
        padding: 20,
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
          borderRadius: 14,
          width: "min(520px, 100%)",
          maxHeight: "min(80vh, 640px)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 40px 120px #00000090"
        }}
      >
        <div style={{ padding: "20px 22px 12px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: C.mono, fontSize: 10, letterSpacing: "0.14em", color: C.muted, marginBottom: 6 }}>
            LIVE SIGNAL STREAM
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <h2 id={titleId} style={{ margin: 0, fontFamily: C.serif, fontSize: 22, fontWeight: 600, color: C.text, flex: 1 }}>
              {release?.version || "Release"}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.muted, fontSize: 18, cursor: "pointer" }}>
              ✕
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, fontSize: 11, fontFamily: C.mono }}>
            <span style={{ color: statusColor }}>● {statusLabel}</span>
            {(collectionDeadline || release?.collection_deadline) && (
              <span style={{ color: C.muted }}>
                Deadline{" "}
                {new Date(collectionDeadline || release.collection_deadline).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </span>
            )}
          </div>
          {earlyWarning?.overall_risk && earlyWarning.overall_risk !== "stable" && (
            <div style={{ marginTop: 10, fontSize: 12, color: C.amber }}>
              Early warning: {earlyWarning.overall_risk.replace(/_/g, " ")}
              {earlyWarning.warning_count != null ? ` (${earlyWarning.warning_count})` : ""}
            </div>
          )}
          {error && (
            <div style={{ marginTop: 8, fontSize: 12, color: C.red }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "12px 22px 20px" }}>
          {events.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
              Waiting for webhook and integration signal events. Connect ingest under Settings → Signal sources, or use Pull from connected sources on the release row.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {[...events].reverse().map((ev, i) => (
                <li
                  key={`${ev.type}-${ev.ts}-${i}`}
                  style={{
                    padding: "10px 0",
                    borderBottom: i < events.length - 1 ? `1px solid ${C.border}` : "none",
                    fontSize: 13,
                    color: C.text
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{eventLabel(ev)}</span>
                    <span style={{ fontFamily: C.mono, fontSize: 11, color: C.dim }}>{formatEventTime(ev.ts)}</span>
                  </div>
                  {ev.type === "signal_progress" && ev.early_warning?.overall_risk && (
                    <div style={{ fontSize: 12, color: C.muted }}>Risk: {ev.early_warning.overall_risk}</div>
                  )}
                  {ev.type === "deadline_extended" && ev.collection_deadline && (
                    <div style={{ fontSize: 12, color: C.muted }}>
                      New deadline {new Date(ev.collection_deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
