/**
 * Verdict Instrument mark — shared SVG paths (Fog/Ink + verdict fills).
 * See verdikt-logo-system.html at repo root for rationale.
 */

export const VERDIKT_MARK_VARIANTS = {
  onDark: { fill: "#c4d4e8", stroke: "#060810", strokeW: 6.5, serifW: 4 },
  onLight: { fill: "#060810", stroke: "#c4d4e8", strokeW: 6.5, serifW: 4 },
  certified: { fill: "#22c55e", stroke: "#060810", strokeW: 6.5, serifW: 4 },
  override: { fill: "#f59e0b", stroke: "#060810", strokeW: 6.5, serifW: 4 },
  uncertified: { fill: "#ef4444", stroke: "#ffffff", strokeW: 6.5, serifW: 4 }
};

/** Inner SVG content (viewBox 0 0 80 80) — use inside an <svg viewBox="0 0 80 80"> */
export function verdiktMarkInnerPaths(variantKey = "onDark") {
  const v = VERDIKT_MARK_VARIANTS[variantKey] || VERDIKT_MARK_VARIANTS.onDark;
  return `
    <rect width="80" height="80" rx="18" fill="${v.fill}"/>
    <path d="M22 22 L40 56" stroke="${v.stroke}" stroke-width="${v.strokeW}" stroke-linecap="round"/>
    <path d="M40 56 L62 22" stroke="${v.stroke}" stroke-width="${v.strokeW}" stroke-linecap="round"/>
    <path d="M16 22 L28 22" stroke="${v.stroke}" stroke-width="${v.serifW}" stroke-linecap="round"/>
  `.trim();
}

/** Full inline SVG for email clients & string-built HTML */
export function verdiktMarkSvgString(size, variantKey = "onDark") {
  return `<svg width="${size}" height="${size}" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Verdikt">${verdiktMarkInnerPaths(variantKey)}</svg>`;
}

/** Map BadgePage demo state to mark variant */
export function verdictStateToMarkVariant(state) {
  if (state === "certified") return "certified";
  if (state === "uncertified") return "uncertified";
  if (state === "override") return "override";
  return "onDark";
}
