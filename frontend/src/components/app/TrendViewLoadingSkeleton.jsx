import { C } from "../../theme/tokens.js";

export default function TrendViewLoadingSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "48px 24px",
        minHeight: 280,
        color: C.muted,
        fontFamily: C.mono,
        fontSize: 12
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: `2px solid ${C.border}`,
          borderTopColor: C.accent,
          animation: "verdikt-spin 0.75s linear infinite"
        }}
      />
      <span>Loading signal trend data…</span>
      <style>{`@keyframes verdikt-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
