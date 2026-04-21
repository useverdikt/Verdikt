import React from "react";
import { C } from "../../theme/tokens.js";

export default function ApiBanner({ message, onDismiss }) {
  if (!message) return null;

  return (
    <div
      style={{
        flexShrink: 0,
        padding: "10px 16px",
        background: "rgba(239,68,68,0.12)",
        borderBottom: "1px solid rgba(239,68,68,0.35)",
        color: C.text,
        fontSize: 12,
        fontFamily: C.mono,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
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
