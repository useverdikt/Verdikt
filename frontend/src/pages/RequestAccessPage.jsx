import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSafeApiBase } from "../lib/apiBase.js";
import { VerdiktMark } from "../components/brand/VerdiktMark.jsx";

const CALENDLY = (import.meta.env.VITE_CALENDLY_URL || "").trim();
const SUPPORT_EMAIL = (import.meta.env.VITE_CONTACT_EMAIL || "hello@useverdikt.com").trim();

const ROOT = {
  minHeight: "100vh",
  background: "#060810",
  color: "#c4d4e8",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  fontFamily: "'DM Sans', system-ui, sans-serif",
  position: "relative",
  overflow: "hidden"
};

const CARD = {
  width: "100%",
  maxWidth: 480,
  background: "#090d14",
  border: "1px solid #18243a",
  borderRadius: 14,
  padding: "40px 40px 36px",
  position: "relative",
  zIndex: 1
};

const INPUT = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 7,
  border: "1px solid #18243a",
  background: "#060810",
  color: "#c4d4e8",
  fontSize: 14,
  fontFamily: "'DM Sans', sans-serif",
  outline: "none",
  boxSizing: "border-box"
};

const SELECT = {
  ...INPUT,
  marginBottom: 16,
  cursor: "pointer"
};

const LABEL = {
  display: "block",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "#384d60",
  marginBottom: 8
};

const SECTION = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 13,
  fontWeight: 600,
  color: "#6e87a2",
  marginTop: 8,
  marginBottom: 14
};

const Q_ROLE = [
  { value: "engineering_leadership", label: "Engineering leadership (VP / Director / Head of Eng)" },
  { value: "quality_qe", label: "Quality / QE / Test leadership" },
  { value: "platform_sre", label: "Platform / SRE / DevOps leadership" },
  { value: "ic_solo_other", label: "IC engineer / solo founder / other" }
];

const Q_TEAM = [
  { value: "just_me", label: "Just me" },
  { value: "2_5", label: "2–5" },
  { value: "6_20", label: "6–20" },
  { value: "21_plus", label: "21+" }
];

const Q_PROCESS = [
  { value: "informal", label: "Mostly informal (Slack, verbal, little written)" },
  { value: "ticket_some", label: "Ticket / issue with some record" },
  { value: "formal_audit", label: "Formal approval / change record / audit expectation" }
];

const Q_PAIN = [
  { value: "reputation", label: "Reputation / trust" },
  { value: "revenue", label: "Revenue / customers" },
  { value: "compliance", label: "Security / compliance / audit" },
  { value: "eng_time", label: "Engineering time (incidents, firefighting)" },
  { value: "other", label: "Other" }
];

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Prefer API { error }; handle HTML/empty bodies (proxy 502, 404 SPA fallback). */
function messageForFailedRequest(res, data) {
  const dev = import.meta.env.DEV;
  const friendly = `We couldn’t send your request right now. Try again in a moment, or email ${SUPPORT_EMAIL}.`;

  if (typeof data?.error === "string" && data.error.trim()) return data.error;
  if (typeof data?.message === "string" && data.message.trim()) return data.message;
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return dev
      ? "Couldn’t reach the API. Start the backend on port 8787 (e.g. cd backend && npm start), then try again."
      : friendly;
  }
  if (res.status === 404) {
    return dev
      ? "API not found — use npm run dev (or vite preview with backend running), not opening the built index.html directly."
      : friendly;
  }
  if (res.status === 429) {
    return "Too many submissions from this network. Try again in a little while.";
  }
  if (res.status >= 500) {
    return dev
      ? "Server error — check the backend logs. If you just updated code, restart the API so migrations run."
      : friendly;
  }
  return dev ? `Couldn’t send (${res.status}). Try again.` : friendly;
}

export default function RequestAccessPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [qRole, setQRole] = useState("");
  const [qTeamSize, setQTeamSize] = useState("");
  const [qReleaseProcess, setQReleaseProcess] = useState("");
  const [painPoints, setPainPoints] = useState([]);
  const [qGoal, setQGoal] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const trimmedCompany = company.trim();
  const emailValid = looksLikeEmail(trimmedEmail);

  const painOk = painPoints.length >= 1 && painPoints.length <= 2;
  const canSubmit =
    trimmedName.length > 0 &&
    emailValid &&
    trimmedCompany.length > 0 &&
    qRole &&
    qTeamSize &&
    qReleaseProcess &&
    painOk;

  const submitDisabled = !canSubmit || status === "loading" || status === "success";

  function togglePain(value) {
    setPainPoints((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (prev.length >= 2) return prev;
      return [...prev, value];
    });
  }

  useEffect(() => {
    document.title = "Verdikt — Join waitlist";
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit || status === "loading" || status === "success") return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const base = getSafeApiBase();
      const url = base ? `${base.replace(/\/$/, "")}/api/waitlist-requests` : "/api/waitlist-requests";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          company: trimmedCompany,
          q_role: qRole,
          q_team_size: qTeamSize,
          q_release_process: qReleaseProcess,
          q_pain_points: painPoints,
          q_goal: qGoal.trim() || undefined,
          message: message.trim() || undefined
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(messageForFailedRequest(res, data));
        setStatus("idle");
        return;
      }
      setStatus("success");
    } catch {
      setErrorMsg(
        "Could not reach the server. Start the API (e.g. npm start in backend/) or check your connection."
      );
      setStatus("idle");
    }
  };

  return (
    <div style={ROOT}>
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background: "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(34,197,94,.04) 0%, transparent 70%)"
        }}
      />

      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          padding: "20px 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 10
        }}
      >
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <span style={{ lineHeight: 0, display: "flex" }}>
            <VerdiktMark size={32} variant="onDark" />
          </span>
          <span
            style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: 17,
              fontWeight: 600,
              color: "#c4d4e8",
              letterSpacing: "-0.02em"
            }}
          >
            Verdikt
          </span>
        </Link>
        <Link
          to="/login"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            color: "#6e87a2",
            textDecoration: "none"
          }}
        >
          Sign in →
        </Link>
      </header>

      <div style={CARD}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: ".14em",
            color: "#22c55e",
            textTransform: "uppercase",
            marginBottom: 28
          }}
        >
          <div style={{ width: 24, height: 1, background: "#22c55e" }} />
          Join the waitlist
        </div>

        <h1
          style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 40,
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: "-.01em",
            color: "#e8f0f8",
            margin: "0 0 10px"
          }}
        >
          Get on the list for <em style={{ fontStyle: "italic", fontWeight: 400, color: "#6e87a2" }}>your team.</em>
        </h1>
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 15,
            fontWeight: 300,
            color: "#6e87a2",
            lineHeight: 1.6,
            marginBottom: 28
          }}
        >
          Closed beta — we onboard partners manually. A few questions help us prioritize the right teams.
          {CALENDLY ? " Follow up by email, or book a short call below." : " We'll follow up by email."}
        </p>

        {status === "success" ? (
          <div
            role="status"
            style={{
              padding: "20px 0 8px",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 16,
              color: "#22c55e",
              lineHeight: 1.6
            }}
          >
            Thanks — we received your request. We&apos;ll follow up by email.
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <label htmlFor="ra-name" style={LABEL}>
              Name <span style={{ color: "#7c3aed" }}>*</span>
            </label>
            <input
              id="ra-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              aria-required="true"
              style={{ ...INPUT, marginBottom: 16 }}
            />

            <label htmlFor="ra-email" style={LABEL}>
              Work email <span style={{ color: "#7c3aed" }}>*</span>
            </label>
            <input
              id="ra-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@company.com"
              aria-required="true"
              aria-invalid={trimmedEmail.length > 0 && !emailValid}
              style={{ ...INPUT, marginBottom: 16 }}
            />

            <label htmlFor="ra-co" style={LABEL}>
              Company <span style={{ color: "#7c3aed" }}>*</span>
            </label>
            <input
              id="ra-co"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
              autoComplete="organization"
              aria-required="true"
              style={{ ...INPUT, marginBottom: 20 }}
            />

            <div style={SECTION}>A few quick questions</div>

            <label htmlFor="ra-q-role" style={LABEL}>
              What best describes your role? <span style={{ color: "#7c3aed" }}>*</span>
            </label>
            <select
              id="ra-q-role"
              value={qRole}
              onChange={(e) => setQRole(e.target.value)}
              required
              style={SELECT}
              aria-required="true"
            >
              <option value="">Choose one</option>
              {Q_ROLE.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <label htmlFor="ra-q-team" style={LABEL}>
              Roughly how many people touch a typical production release? <span style={{ color: "#7c3aed" }}>*</span>
            </label>
            <select
              id="ra-q-team"
              value={qTeamSize}
              onChange={(e) => setQTeamSize(e.target.value)}
              required
              style={SELECT}
              aria-required="true"
            >
              <option value="">Choose one</option>
              {Q_TEAM.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <label htmlFor="ra-q-proc" style={LABEL}>
              When a release ships with known issues today, what happens? <span style={{ color: "#7c3aed" }}>*</span>
            </label>
            <select
              id="ra-q-proc"
              value={qReleaseProcess}
              onChange={(e) => setQReleaseProcess(e.target.value)}
              required
              style={SELECT}
              aria-required="true"
            >
              <option value="">Choose one</option>
              {Q_PROCESS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <fieldset style={{ border: "none", margin: "0 0 16px", padding: 0 }}>
              <legend style={{ ...LABEL, marginBottom: 10 }}>
                What would hurt most if a bad release reached users? <span style={{ color: "#7c3aed" }}>*</span>{" "}
                <span style={{ textTransform: "none", letterSpacing: "0", fontWeight: 400 }}>(pick 1–2)</span>
              </legend>
              {Q_PAIN.map((o) => {
                const checked = painPoints.includes(o.value);
                const atMax = painPoints.length >= 2 && !checked;
                return (
                  <label
                    key={o.value}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      marginBottom: 10,
                      cursor: atMax ? "not-allowed" : "pointer",
                      opacity: atMax ? 0.45 : 1,
                      fontSize: 14,
                      color: "#c4d4e8",
                      fontFamily: "'DM Sans', sans-serif"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={atMax}
                      onChange={() => togglePain(o.value)}
                      style={{ marginTop: 3 }}
                    />
                    <span>{o.label}</span>
                  </label>
                );
              })}
            </fieldset>

            <label htmlFor="ra-goal" style={LABEL}>
              In one sentence, what would you want Verdikt to make true about your releases? (optional)
            </label>
            <input
              id="ra-goal"
              value={qGoal}
              onChange={(e) => setQGoal(e.target.value)}
              placeholder="e.g. Every override has a named owner and a record we can show in review"
              style={{ ...INPUT, marginBottom: 16 }}
            />

            <label htmlFor="ra-msg" style={LABEL}>
              Anything else we should know? (optional)
            </label>
            <textarea
              id="ra-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              style={{
                ...INPUT,
                resize: "vertical",
                minHeight: 72,
                marginBottom: 12,
                lineHeight: 1.5
              }}
            />

            {errorMsg ? (
              <p
                role="alert"
                style={{
                  margin: "0 0 12px",
                  fontSize: 13,
                  color: "#f87171",
                  lineHeight: 1.45
                }}
              >
                {errorMsg}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitDisabled}
              style={{
                width: "100%",
                background: submitDisabled ? "#384d60" : "#c4d4e8",
                color: "#060810",
                border: "none",
                borderRadius: 7,
                padding: "13px 0",
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: submitDisabled ? "not-allowed" : "pointer",
                letterSpacing: ".04em",
                opacity: submitDisabled ? 0.55 : 1
              }}
            >
              {status === "loading" ? "Sending…" : "Send request"}
            </button>
          </form>
        )}

        {CALENDLY ? (
          <p style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: "#6e87a2" }}>
            Prefer to book time?{" "}
            <a href={CALENDLY} target="_blank" rel="noopener noreferrer" style={{ color: "#22c55e" }}>
              Schedule a call
            </a>
          </p>
        ) : null}

        <p style={{ marginTop: 24, textAlign: "center", fontSize: 12, color: "#384d60", lineHeight: 1.5 }}>
          Already invited?{" "}
          <Link to="/login" style={{ color: "#6e87a2", textDecoration: "none" }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
