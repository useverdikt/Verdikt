import React from "react";
import { Link } from "react-router-dom";

export function ChevronNext() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path
        d="M5 2.5L8.5 6.5 5 10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronBack() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path
        d="M8 2.5L4.5 6.5 8 10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InvitationClosed({ mode }) {
  const apiError = mode === "error";
  return (
    <div
      className="shell"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg, #0a0d12)",
        color: "var(--text, #c4d4e8)"
      }}
    >
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <p
          style={{
            fontFamily: "var(--mono, 'JetBrains Mono', monospace)",
            fontSize: 10,
            letterSpacing: ".14em",
            color: "#22c55e",
            marginBottom: 16,
            textTransform: "uppercase"
          }}
        >
          Design partner access
        </p>
        <h1
          style={{
            fontFamily: "var(--serif, 'Cormorant Garamond', Georgia, serif)",
            fontSize: "clamp(28px, 5vw, 36px)",
            fontWeight: 600,
            marginBottom: 16,
            lineHeight: 1.15
          }}
        >
          Self-service signup isn&apos;t open yet
        </h1>
        <p style={{ color: "var(--dim, #6e87a2)", lineHeight: 1.65, marginBottom: 28, fontSize: 15 }}>
          {apiError
            ? "We could not verify signup settings from the server. Check your connection and try again, or sign in if you already have an account."
            : "New workspaces are created for approved teams. Join the waitlist and we’ll follow up, or sign in if you already have an account."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "stretch" }}>
          <Link
            to="/request-access"
            className="btn-primary"
            style={{ textAlign: "center", textDecoration: "none", display: "block", padding: "14px 20px", borderRadius: 8 }}
          >
            Join waitlist
          </Link>
          <Link
            to="/login"
            style={{
              textAlign: "center",
              color: "var(--accent, #22c55e)",
              textDecoration: "none",
              fontFamily: "var(--mono)",
              fontSize: 13
            }}
          >
            Sign in →
          </Link>
          <Link to="/" style={{ textAlign: "center", color: "var(--dim)", fontSize: 13, textDecoration: "none", marginTop: 8 }}>
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
