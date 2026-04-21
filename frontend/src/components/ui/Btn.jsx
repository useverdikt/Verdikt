import React from "react";
import { C } from "../../theme/tokens.js";

export function Btn({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  style = {}
}) {
  const bg = {
    primary: C.accent,
    green: C.green,
    amber: C.amber,
    red: C.red,
    ghost: "transparent",
    surface: C.raise
  }[variant] || C.raise;
  const fg = ["primary", "green", "amber", "red"].includes(variant) ? "#000" : C.muted;
  return (
    <button
      type="button"
      onClick={!disabled ? onClick : undefined}
      style={{
        background: disabled ? C.dim : bg,
        color: disabled ? "#444" : fg,
        border: variant === "ghost" ? `1px solid ${C.border}` : "none",
        borderRadius: 8,
        padding: "9px 20px",
        fontWeight: 800,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.15s",
        ...style
      }}
    >
      {children}
    </button>
  );
}
