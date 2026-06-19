import React from "react";
import { C } from "../../theme/tokens.js";

function formatBypassDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function remediationDebtBannerText(debt) {
  if (!debt?.active) return null;
  const version = debt.source_version || "prior release";
  const when = formatBypassDate(debt.since);
  const whenPart = when ? ` (bypassed ${when})` : "";
  return `Remediation debt active from ${version}${whenPart}. Ship CERTIFIED (no override) to recover.`;
}

export default function RemediationDebtBanner({ debt, compact = false }) {
  const text = remediationDebtBannerText(debt);
  if (!text) return null;

  return (
    <div
      role="status"
      style={{
        background: C.redDim || "rgba(239,68,68,0.12)",
        border: `1px solid ${C.red}40`,
        borderRadius: compact ? 8 : 10,
        padding: compact ? "10px 12px" : "12px 14px",
        marginBottom: compact ? 14 : 16,
        fontSize: compact ? 12 : 13,
        lineHeight: 1.55,
        color: C.muted
      }}
    >
      <strong style={{ color: C.red, fontWeight: 700 }}>Blocked — </strong>
      {text}
    </div>
  );
}
