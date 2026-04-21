import React from "react";
import { ACCOUNT_ROLES } from "../onboardingConstants.js";

const ROLE_SELECTED_BG = {
  ai_product_lead: "rgba(6, 182, 212, 0.08)",
  ml_engineer: "rgba(16, 185, 129, 0.08)",
  qe_lead: "rgba(167, 139, 250, 0.08)",
  vp_engineering: "rgba(245, 158, 11, 0.08)",
  cto: "rgba(236, 72, 153, 0.08)",
  engineer: "rgba(107, 114, 128, 0.08)"
};

export default function AccountStep({ st, setSt, regError, regStatus }) {
  return (
    <>
      <div className="step-eyebrow">Step 6 of 6</div>
      <h1 className="step-title display">
        Who are you
        <br />
        <em>in this workspace?</em>
      </h1>
      <p className="step-body">
        Your name and role are attached to every certification and override.{" "}
        <strong>You decide who can override</strong> — configure approval authority in workspace settings to
        match your org (Tech Lead, Release Manager, QE Lead, VP Eng, etc.).
      </p>
      <div style={{ maxWidth: 520 }}>
        <div className="field">
          <label className="field-label">Your name</label>
          <input
            className="inp"
            placeholder="e.g. Jordan Blake"
            value={st.user.name}
            onChange={(e) => setSt((s) => ({ ...s, user: { ...s.user, name: e.target.value } }))}
            autoComplete="name"
          />
        </div>
        <div className="field">
          <label className="field-label">Work email</label>
          <input
            className="inp"
            type="email"
            placeholder="you@company.com"
            value={st.email}
            onChange={(e) => setSt((s) => ({ ...s, email: e.target.value }))}
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label className="field-label">Password (min 8 characters)</label>
          <input
            className="inp"
            type="password"
            placeholder="••••••••"
            value={st.password}
            onChange={(e) => setSt((s) => ({ ...s, password: e.target.value }))}
            autoComplete="new-password"
          />
        </div>
        <div className="field">
          <label className="field-label">Confirm password</label>
          <input
            className="inp"
            type="password"
            placeholder="••••••••"
            value={st.password2}
            onChange={(e) => setSt((s) => ({ ...s, password2: e.target.value }))}
            autoComplete="new-password"
          />
        </div>
        {regError ? (
          <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{regError}</div>
        ) : null}
        {regStatus ? (
          <div style={{ color: "var(--mid)", fontSize: 12, marginBottom: 12, fontFamily: "var(--mono)" }}>
            {regStatus}
          </div>
        ) : null}
        <div className="field">
          <label className="field-label">Your role</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            {ACCOUNT_ROLES.map((r) => {
              const active = st.user.role === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={r.label}
                  onClick={() => setSt((s) => ({ ...s, user: { ...s.user, role: r.id } }))}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "13px 15px",
                    borderRadius: 9,
                    border: `1px solid ${active ? r.color : "var(--border)"}`,
                    background: active ? ROLE_SELECTED_BG[r.id] || "var(--raise)" : "var(--raise)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    width: "100%",
                    appearance: "none",
                    font: "inherit",
                    textAlign: "left",
                    color: "inherit"
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: active ? r.color : "var(--dim)",
                      flexShrink: 0,
                      marginTop: 5,
                      boxShadow: active ? `0 0 7px ${r.color}` : "none"
                    }}
                  />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: active ? r.color : "var(--text)"
                        }}
                      >
                        {r.label}
                      </span>
                      {r.id === "engineer" ? (
                        <span
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 9,
                            color: "var(--mid)",
                            background: "var(--border)",
                            padding: "1px 6px",
                            borderRadius: 3,
                            fontWeight: 700,
                            letterSpacing: "0.06em"
                          }}
                        >
                          READ ONLY
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--mid)",
                        marginTop: 3,
                        lineHeight: 1.55,
                        fontWeight: 300
                      }}
                    >
                      {r.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
