import { C } from "./theme.js";

export function btnStyle(color) {
  return {
    padding: "7px 14px",
    borderRadius: 7,
    border: `1px solid ${color}40`,
    background: `${color}12`,
    color,
    fontSize: 12,
    fontFamily: C.mono,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap"
  };
}

export const thStyle = {
  padding: "7px 10px",
  fontSize: 10,
  fontFamily: C.mono,
  color: C.dim,
  letterSpacing: "0.07em",
  textAlign: "left",
  borderBottom: `1px solid ${C.border}`,
  fontWeight: 600,
  background: "rgba(255,255,255,0.015)"
};

export const tdStyle = {
  padding: "8px 10px",
  fontSize: 12.5,
  color: C.muted,
  borderBottom: "1px solid rgba(255,255,255,0.05)"
};
