import React from "react";

export default function AppContentSwitch({
  isMobile,
  nav,
  ReleaseView,
  TrendView,
  ThresholdsView,
  AuditView
}) {
  // Release view owns its own layout (header + body-split) — no outer padding
  if (nav === "release") {
    return (
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <ReleaseView />
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
      {nav === "trend" && <TrendView />}
      {nav === "thresholds" && <ThresholdsView />}
      {nav === "audit" && <AuditView />}
    </div>
  );
}
