import React from "react";
import { RTYPES } from "../onboardingConstants.js";
import { REG_CLASS, REG_LABELS } from "../onboardingUtils.js";

export default function ReleaseTypesStep({ st, toggleRT }) {
  return (
    <>
      <div className="step-eyebrow">Step 3 of 6</div>
      <h1 className="step-title display">
        Which change types
        <br />
        <em>does your team ship?</em>
      </h1>
      <p className="step-body">
        Verdikt uses release type to determine whether E2E regression is required, waivable, or role-based.{" "}
        <strong>Select all that apply to your workflow.</strong>
      </p>
      <div className="chips" style={{ maxWidth: 620, marginBottom: 28 }}>
        {RTYPES.map((rt) => (
          <button
            key={rt.id}
            type="button"
            className={`chip ${st.rtypes.includes(rt.id) ? "active" : ""}`}
            aria-pressed={st.rtypes.includes(rt.id)}
            aria-label={`${rt.label}, ${REG_LABELS[rt.reg]}`}
            onClick={() => toggleRT(rt.id)}
          >
            <span>{rt.icon}</span>
            {rt.label}
            <span className={`reg-tag ${REG_CLASS[rt.reg]}`}>{REG_LABELS[rt.reg]}</span>
          </button>
        ))}
      </div>
      <div
        style={{
          maxWidth: 540,
          background: "var(--raise)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          padding: "16px 18px"
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--accent)",
            letterSpacing: "0.12em",
            marginBottom: 10
          }}
        >
          REGRESSION LOGIC
        </div>
        <div style={{ fontSize: 13, color: "var(--mid)", lineHeight: 1.75 }}>
          <strong style={{ color: "var(--text)" }}>Required</strong> — must pass or release is UNCERTIFIED.
          <br />
          <strong style={{ color: "var(--text)" }}>Waivable</strong> — can skip with a named reason on permanent
          record.
          <br />
          <strong style={{ color: "var(--text)" }}>Role discretion</strong> — default is QE Lead; override
          authority is configurable in settings.
        </div>
      </div>
    </>
  );
}
