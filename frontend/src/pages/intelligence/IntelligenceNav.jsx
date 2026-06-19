import React from "react";
import { NavLink } from "react-router-dom";
import { C } from "./theme.js";
import { INTELLIGENCE_NAV_GROUPS } from "./intelligenceNav.js";

const navLinkStyle = ({ isActive }) => ({
  display: "block",
  padding: "8px 10px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: isActive ? 600 : 400,
  color: isActive ? C.text : C.mid,
  background: isActive ? C.raise : "transparent",
  border: isActive ? `1px solid ${C.borderL}` : "1px solid transparent",
  textDecoration: "none",
  lineHeight: 1.35,
  transition: "background .15s, color .15s"
});

const sectionHeaderStyle = {
  fontFamily: C.mono,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: C.dim,
  padding: "14px 10px 6px",
  margin: 0
};

export default function IntelligenceNav({ isMobile }) {
  return (
    <nav
      aria-label="Intelligence Hub sections"
      style={{
        width: isMobile ? "100%" : 240,
        flexShrink: 0,
        borderRight: isMobile ? "none" : `1px solid ${C.border}`,
        borderBottom: isMobile ? `1px solid ${C.border}` : "none",
        padding: isMobile ? "12px 16px" : "20px 12px",
        overflowY: isMobile ? "visible" : "auto"
      }}
    >
      <div
        style={{
          fontFamily: C.mono,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: C.dim,
          padding: "0 10px 12px"
        }}
      >
        Intelligence
      </div>
      {INTELLIGENCE_NAV_GROUPS.map((group, gi) => (
        <div key={group.header || `group-${gi}`}>
          {group.header ? <div style={sectionHeaderStyle}>{group.header}</div> : null}
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={navLinkStyle}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
