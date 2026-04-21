import React from "react";
import { C } from "../../theme/tokens.js";
import { VerdiktMark } from "../brand/VerdiktMark.jsx";

export const Inp = ({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint
}) => /* @__PURE__ */ React.createElement("div", {
  style: {
    marginBottom: 14
  }
}, label && /* @__PURE__ */ React.createElement("label", {
  style: {
    display: "block",
    fontSize: 10,
    color: C.muted,
    fontWeight: 700,
    marginBottom: 5,
    letterSpacing: "0.1em",
    fontFamily: C.mono
  }
}, label), /* @__PURE__ */ React.createElement("input", {
  value,
  onChange: (e) => onChange(e.target.value),
  placeholder,
  type,
  style: {
    width: "100%",
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    padding: "9px 13px",
    color: C.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box"
  }
}), hint && /* @__PURE__ */ React.createElement("div", {
  style: {
    fontSize: 11,
    color: C.dim,
    marginTop: 3
  }
}, hint));

export const Logo = () => /* @__PURE__ */ React.createElement("div", {
  style: { display: "flex", alignItems: "center", gap: 9 }
},
/* @__PURE__ */ React.createElement("span", { style: { lineHeight: 0, flexShrink: 0 } },
  /* @__PURE__ */ React.createElement(VerdiktMark, { size: 26, variant: "onDark" })),
/* @__PURE__ */ React.createElement("div", null,
  /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: C.serif, fontSize: 15, fontWeight: 600, color: C.text, letterSpacing: "-0.02em" }
  }, "Verdikt"),
  /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: C.mono, fontSize: 9, color: C.dim, letterSpacing: ".12em", marginTop: 2, textTransform: "uppercase" }
  }, "Release Intelligence System")
));
