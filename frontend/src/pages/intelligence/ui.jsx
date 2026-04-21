import React from "react";
import { C } from "./theme.js";

export function Badge({ color, children, style }) {
  return (
    <span
      style={{
        fontFamily: C.mono,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color,
        background: color + "18",
        border: `1px solid ${color}30`,
        padding: "1px 7px",
        borderRadius: 3,
        ...style
      }}
    >
      {children}
    </span>
  );
}

export function Card({ title, eyebrow, children, action }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div
        style={{
          padding: "14px 20px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div>
          {eyebrow && (
            <div
              style={{
                fontFamily: C.mono,
                fontSize: 9,
                color: C.dim,
                letterSpacing: "0.1em",
                marginBottom: 2,
                textTransform: "uppercase"
              }}
            >
              {eyebrow}
            </div>
          )}
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</div>
        </div>
        {action}
      </div>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}

export function Spinner() {
  return <div style={{ color: C.dim, fontSize: 13, fontFamily: C.mono }}>Loading…</div>;
}

export function EmptyState({ msg }) {
  return <div style={{ color: C.dim, fontSize: 13, textAlign: "center", padding: "24px 0" }}>{msg}</div>;
}
