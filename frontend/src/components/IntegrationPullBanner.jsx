import React from "react";
import { Link } from "react-router-dom";
import { C } from "../theme/tokens.js";
import { integrationPullBannerWarnings } from "../lib/releaseSourceLanes.js";

const TONE = {
  amber: { border: "rgba(245,158,11,0.25)", bg: "rgba(245,158,11,0.07)", color: C.amber },
  red: { border: "rgba(248,113,113,0.25)", bg: "rgba(248,113,113,0.07)", color: "#f87171" }
};

export default function IntegrationPullBanner({ integrationPull, releaseId, compact = false }) {
  const messages = integrationPullBannerWarnings(integrationPull);
  if (!messages.length) return null;

  const tone = messages.some((m) => /rejected|missing|invalid/i.test(m)) ? TONE.red : TONE.amber;
  const simHref = releaseId ? `/signal-sim?release=${encodeURIComponent(releaseId)}` : "/signal-sim";

  return (
    <div
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
        padding: compact ? "10px 14px" : "12px 16px",
        marginBottom: compact ? 0 : 4
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: tone.color, fontFamily: C.mono, letterSpacing: "0.06em", marginBottom: 8 }}>
        INTEGRATION PULL · ACTION NEEDED
      </div>
      {messages.slice(0, compact ? 2 : 5).map((msg, i) => (
        <div key={i} style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, marginTop: i ? 6 : 0 }}>
          {msg}
        </div>
      ))}
      {!compact && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <Link to={simHref} style={{ color: C.green, marginRight: 12 }}>
            Open Signal Simulator →
          </Link>
          <Link to="/settings?section=api" style={{ color: C.muted }}>
            Settings → Signal sources
          </Link>
        </div>
      )}
    </div>
  );
}
