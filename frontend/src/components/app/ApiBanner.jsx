import React, { useMemo, useState } from "react";
import { C } from "../../theme/tokens.js";
import { resolveApiBanner } from "../../lib/apiErrorCopy.js";

export default function ApiBanner({ message, onDismiss }) {
  const [showDetail, setShowDetail] = useState(false);
  const resolved = useMemo(() => resolveApiBanner(message), [message]);

  if (!resolved) return null;

  const { title, detail } = resolved;
  const detailDiffers = detail && detail !== title;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        flexShrink: 0,
        padding: "10px 16px",
        background: "rgba(239,68,68,0.12)",
        borderBottom: "1px solid rgba(239,68,68,0.35)",
        color: C.text,
        fontSize: 12,
        fontFamily: C.mono,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, marginBottom: detailDiffers && showDetail ? 6 : 0 }}>{title}</div>
        {detailDiffers && showDetail ? (
          <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.5, wordBreak: "break-word" }}>{detail}</div>
        ) : null}
        {detailDiffers ? (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            style={{
              marginTop: 6,
              background: "transparent",
              border: "none",
              color: C.dim,
              fontSize: 10,
              fontFamily: C.mono,
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline"
            }}
          >
            {showDetail ? "Hide details" : "Show details"}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error banner"
        style={{
          flexShrink: 0,
          background: "transparent",
          border: `1px solid ${C.border}`,
          color: C.muted,
          borderRadius: 6,
          padding: "4px 10px",
          cursor: "pointer",
          fontFamily: C.mono,
          fontSize: 11
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
