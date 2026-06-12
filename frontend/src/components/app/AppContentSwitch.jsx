import React from "react";

export default function AppContentSwitch({
  isMobile,
  nav,
  releaseContent,
  trendContent,
  thresholdsContent,
  auditContent,
  escalationsContent
}) {
  if (nav === "release") {
    return (
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
        {releaseContent}
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      overflow: "auto",
      padding: isMobile ? "16px 12px 18px" : "24px 28px",
      minWidth: 0,
    }}>
      {nav === "trend" && trendContent}
      {nav === "thresholds" && thresholdsContent}
      {nav === "audit" && auditContent}
      {nav === "escalations" && escalationsContent}
    </div>
  );
}
