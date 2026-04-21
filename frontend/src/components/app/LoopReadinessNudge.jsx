import React from "react";
import { C } from "../../theme/tokens.js";

/** Fixed strip below optional API error banner — “connect VCS” loop closure prompt. */
export default function LoopReadinessNudge({ visible, apiBannerVisible, onDismiss, onConnect }) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: apiBannerVisible ? 48 : 0,
        left: 0,
        right: 0,
        zIndex: 120,
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 20px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontFamily: C.sans,
        fontSize: 13
      }}
    >
      <span style={{ fontSize: 16 }}>⊙</span>
      <span style={{ color: C.muted, flex: 1 }}>
        <strong style={{ color: C.text }}>Close the feedback loop. </strong>
        You have certified releases but no post-deploy observations. Connect your VCS integration to
        automatically monitor for reverts and incidents.
      </span>
      <a
        href="/settings"
        onClick={(e) => {
          e.preventDefault();
          onConnect();
        }}
        style={{
          color: C.accent,
          fontSize: 12,
          fontWeight: 700,
          textDecoration: "none",
          whiteSpace: "nowrap",
          padding: "5px 12px",
          border: `1px solid ${C.accent}40`,
          borderRadius: 6
        }}
      >
        Connect VCS →
      </a>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          color: C.dim,
          cursor: "pointer",
          fontSize: 18,
          padding: "0 4px",
          lineHeight: 1
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
