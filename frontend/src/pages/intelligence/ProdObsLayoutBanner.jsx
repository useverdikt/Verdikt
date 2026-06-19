import React from "react";
import { Link } from "react-router-dom";
import { C } from "./theme.js";

export default function ProdObsLayoutBanner() {
  return (
    <div
      role="status"
      style={{
        marginBottom: 20,
        padding: "12px 14px",
        borderRadius: 8,
        background: C.amber + "14",
        border: `1px solid ${C.amber}40`,
        fontSize: 13,
        color: C.mid,
        lineHeight: 1.6
      }}
    >
      <strong style={{ color: C.amber }}>Production observation is off.</strong>{" "}
      Post-deploy loop metrics and alignment data stay hidden until you enable{" "}
      <strong style={{ color: C.text }}>Production observation</strong> in{" "}
      <Link to="/settings?section=workspace" style={{ color: C.accentL, fontWeight: 600 }}>
        Workspace → General
      </Link>
      .
    </div>
  );
}
