import React from "react";
import { VERDIKT_MARK_VARIANTS } from "../../brand/verdiktMarkSvg.js";

export { verdiktMarkSvgString, verdictStateToMarkVariant } from "../../brand/verdiktMarkSvg.js";

/**
 * Verdict Instrument — square mark with V + serif (Fog on Ink, or verdict colours).
 * @param {"onDark"|"onLight"|"certified"|"override"|"uncertified"} variant
 */
export function VerdiktMark({ size = 32, variant = "onDark", className, title, ...rest }) {
  const v = VERDIKT_MARK_VARIANTS[variant] || VERDIKT_MARK_VARIANTS.onDark;
  const label = title ?? "Verdikt";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      className={className}
      role="img"
      aria-label={label}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <rect width="80" height="80" rx="18" fill={v.fill} />
      <path d="M22 22 L40 56" stroke={v.stroke} strokeWidth={v.strokeW} strokeLinecap="round" />
      <path d="M40 56 L62 22" stroke={v.stroke} strokeWidth={v.strokeW} strokeLinecap="round" />
      <path d="M16 22 L28 22" stroke={v.stroke} strokeWidth={v.serifW} strokeLinecap="round" />
    </svg>
  );
}
