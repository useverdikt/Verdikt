import React from "react";

export default function WelcomeStep({ onQuickDemo, onGoToWorkspace }) {
  return (
    <>
      <div className="step-eyebrow">Welcome</div>
      <h1 className="step-title display">
        Here&apos;s the value.
        <br />
        <em>Get there in 30 minutes.</em>
      </h1>
      <p className="step-body">
        Every model update, prompt change, and AI feature — certified against your quality standard, with a
        permanent record of who approved every below-threshold decision.
      </p>
      <p className="step-body" style={{ marginBottom: 28 }}>
        Outcome: your first certified release record — or a shareable certification link — in under 30 minutes.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
        <button
          type="button"
          className="btn-primary"
          style={{
            textAlign: "center",
            textDecoration: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            border: "none",
            cursor: "pointer",
            width: "100%"
          }}
          onClick={onQuickDemo}
        >
          Try the demo in 2 minutes
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M3 8h10M9 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="btn-next"
          style={{
            width: "100%",
            justifyContent: "center",
            background: "var(--raise)",
            border: "1px solid var(--border)",
            color: "var(--text)"
          }}
          onClick={onGoToWorkspace}
        >
          Set up my workspace
        </button>
      </div>
      <p style={{ marginTop: 24, fontSize: 12, color: "var(--dim)", fontFamily: "var(--mono)" }}>
        Integrations and thresholds can wait. First win first.
      </p>
    </>
  );
}
