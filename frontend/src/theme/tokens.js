/**
 * Design tokens — aligned with the landing page aesthetic.
 * Cormorant Garamond (serif headings) · DM Sans (body) · JetBrains Mono (labels/code)
 * Dark navy palette: #060810 base, green/amber/red for verdict states, blue CTA.
 */
export const C = {
  // ── Backgrounds ────────────────────────────────────────────────────────────
  bg:      "#060810",
  surface: "#090d14",
  raise:   "#0d1520",

  // ── Borders ────────────────────────────────────────────────────────────────
  border:  "#18243a",
  borderL: "#243050",

  // ── Verdict state colours ──────────────────────────────────────────────────
  green:    "#22c55e",
  greenDim: "rgba(34,197,94,.12)",
  red:      "#ef4444",
  redDim:   "rgba(239,68,68,.12)",
  amber:    "#f59e0b",
  amberDim: "rgba(245,158,11,.12)",

  // ── UI accent (CTA / interactive) ─────────────────────────────────────────
  accent:       "#3b82f6",
  accentDim:    "rgba(59,130,246,.15)",
  accentBright: "#60a5fa",

  // ── Supporting colours ─────────────────────────────────────────────────────
  cyan:    "#22d3ee",
  cyanDim: "rgba(34,211,238,.12)",
  pink:    "#f472b6",
  pinkDim: "rgba(244,114,182,.12)",

  // ── Typography colours ────────────────────────────────────────────────────
  text:  "#c4d4e8",
  muted: "#6e87a2",
  dim:   "#384d60",

  // ── Font stacks ───────────────────────────────────────────────────────────
  serif: "'Cormorant Garamond', Georgia, serif",
  sans:  "'DM Sans', system-ui, sans-serif",
  mono:  "'JetBrains Mono', 'Courier New', monospace",

  // ── Glass / elevation ─────────────────────────────────────────────────────
  glassBg:         "rgba(9,13,20,.88)",
  glassBgStrong:   "rgba(6,8,16,.92)",
  glassBorder:     "#18243a",
  glassBorderSoft: "rgba(24,36,58,.6)",
  elevShadow:      "0 1px 3px rgba(0,0,0,.3), 0 0 0 1px rgba(196,212,232,.04)",
  elevShadowLg:    "0 20px 48px -14px rgba(0,0,0,.65), inset 0 1px 0 rgba(196,212,232,.05)",
  elevSidebar:     "8px 0 40px rgba(0,0,0,.5)"
};

/**
 * Typography scale — Cormorant Garamond for display headings, DM Sans for reading
 * UI, JetBrains Mono for labels, metrics, and metadata.
 */
export const T = {
  brandWordmark: {
    fontFamily: C.serif,
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: "-.01em",
    lineHeight: 1.05,
    color: C.text,
    fontStyle: "normal"
  },
  brandTagline: {
    fontFamily: C.mono,
    fontSize: 9,
    fontWeight: 500,
    letterSpacing: ".12em",
    lineHeight: 1.25,
    color: C.dim,
    textTransform: "uppercase"
  },
  overline: {
    fontFamily: C.mono,
    fontSize: 9,
    fontWeight: 500,
    letterSpacing: ".12em",
    lineHeight: 1.2,
    color: C.dim,
    textTransform: "uppercase"
  },
  releaseTitle: {
    fontFamily: C.serif,
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: "-.01em",
    lineHeight: 1.1,
    color: C.text
  },
  releaseMeta: {
    fontFamily: C.mono,
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: ".02em",
    lineHeight: 1.45,
    color: C.muted
  },
  releaseBuildId: {
    fontFamily: C.mono,
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: ".04em",
    lineHeight: 1.4,
    color: C.dim
  },
  projectName: {
    fontFamily: C.sans,
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: "-.01em",
    lineHeight: 1.35,
    color: C.text
  },
  projectEnv: {
    fontFamily: C.mono,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: ".04em",
    lineHeight: 1.35,
    color: C.muted
  },
  sectionHeading: {
    fontFamily: C.mono,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: ".1em",
    lineHeight: 1.35,
    color: C.muted,
    textTransform: "uppercase"
  },
  prose: {
    fontFamily: C.sans,
    fontSize: 14,
    fontWeight: 300,
    lineHeight: 1.7,
    color: C.muted
  },
  proseMuted: {
    fontFamily: C.sans,
    fontSize: 13,
    fontWeight: 300,
    lineHeight: 1.65,
    color: C.dim
  },
  labelCaps: {
    fontFamily: C.mono,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: ".1em",
    lineHeight: 1.3,
    color: C.dim,
    textTransform: "uppercase"
  },
  navItem: {
    fontFamily: C.sans,
    fontSize: 13,
    fontWeight: 400,
    letterSpacing: "-.01em",
    lineHeight: 1.35
  },
  dataStrong: {
    fontFamily: C.mono,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: "-.01em",
    lineHeight: 1.35
  },
  uiButton: {
    fontFamily: C.mono,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: ".02em"
  }
};
