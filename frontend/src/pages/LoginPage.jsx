import React, { useState, useEffect } from "react";
import { useNavigate, Link, useLocation, useSearchParams } from "react-router-dom";
import { getSafeApiBase } from "../lib/apiBase.js";
import { persistAuthSession } from "../auth/persistSession.js";
import { isAuthenticated } from "../auth/session.js";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient.js";
import { signInWithSupabase } from "../auth/supabaseAuth.js";
import { VerdiktMark } from "../components/brand/VerdiktMark.jsx";

const SAVED_EMAIL_KEY    = "vdk3_saved_login_email";
const REMEMBER_EMAIL_KEY = "vdk3_remember_login_email";

/* ─── Shared style constants ─────────────────────────────────────────────── */
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
  overflow: "hidden",
};

const CARD = {
  width: "100%",
  maxWidth: 420,
  background: "#090d14",
  border: "1px solid #18243a",
  borderRadius: 14,
  padding: "40px 40px 36px",
  position: "relative",
  zIndex: 1,
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
  transition: "border-color .2s",
};

const LABEL = {
  display: "block",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "#384d60",
  marginBottom: 8,
};

const BTN_PRIMARY = {
  width: "100%",
  background: "#c4d4e8",
  color: "#060810",
  border: "none",
  borderRadius: 7,
  padding: "13px 0",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: "pointer",
  letterSpacing: ".04em",
  transition: "opacity .2s",
};

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const from = location.state?.from && typeof location.state.from === "string"
    ? location.state.from
    : "/releases";
  const resetNotice =
    location.state?.resetNotice && typeof location.state.resetNotice === "string"
      ? location.state.resetNotice
      : "";

  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [rememberEmail, setRememberEmail] = useState(
    () => localStorage.getItem(REMEMBER_EMAIL_KEY) !== "false"
  );
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]             = useState("");
  const [status, setStatus]           = useState("");
  const [busy, setBusy]               = useState(false);

  useEffect(() => {
    document.title = "Verdikt — Sign in";
    return () => { document.title = "Verdikt — Release Intelligence System"; };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      if (isAuthenticated()) navigate(from, { replace: true });
      return;
    }
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate(from, { replace: true });
    });
  }, [navigate, from]);

  useEffect(() => {
    const q = searchParams.get("email");
    if (q && typeof q === "string" && q.trim()) { setEmail(q.trim()); return; }
    if (localStorage.getItem(REMEMBER_EMAIL_KEY) === "false") return;
    const saved = localStorage.getItem(SAVED_EMAIL_KEY);
    if (saved) setEmail(saved);
  }, [searchParams]);

  const persistEmailPreference = (nextEmail) => {
    if (rememberEmail) {
      localStorage.setItem(REMEMBER_EMAIL_KEY, "true");
      localStorage.setItem(SAVED_EMAIL_KEY, nextEmail.trim());
    } else {
      localStorage.setItem(REMEMBER_EMAIL_KEY, "false");
      localStorage.removeItem(SAVED_EMAIL_KEY);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const API_BASE = getSafeApiBase();
    setStatus(`Connecting…`);
    try {
      if (isSupabaseConfigured()) {
        await signInWithSupabase(email.trim(), password);
        persistEmailPreference(email);
        setStatus("Redirecting…");
        navigate(from, { replace: true });
        setBusy(false);
        return;
      }
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("");
        setError(typeof data.error === "string" ? data.error : "Sign in failed");
        setBusy(false);
        return;
      }
      try {
        persistEmailPreference(email);
        persistAuthSession({ user: data.user });
      } catch (storageErr) {
        setStatus("");
        setError("Login succeeded, but browser storage is blocked. Disable private mode and try again.");
        console.error(storageErr);
        setBusy(false);
        return;
      }
      setStatus("Redirecting…");
      navigate(from, { replace: true });
    } catch (err) {
      setStatus("");
      setError(`Cannot reach the API. Is the backend running? (${String(err?.message || err)})`);
      setBusy(false);
    }
  };

  return (
    <div style={ROOT}>
      {/* background glow */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(34,197,94,.04) 0%, transparent 70%)",
      }} />

      {/* nav */}
      <header style={{
        position: "fixed", top: 0, left: 0, right: 0,
        padding: "20px 40px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        zIndex: 10,
      }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <span style={{ lineHeight: 0, display: "flex" }}>
            <VerdiktMark size={32} variant="onDark" />
          </span>
          <span style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 17, fontWeight: 600, color: "#c4d4e8", letterSpacing: "-0.02em",
          }}>Verdikt</span>
        </Link>
        <Link to="/request-access" style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, color: "#6e87a2", textDecoration: "none",
          transition: "color .2s",
        }}>
          Join waitlist →
        </Link>
      </header>

      {/* card */}
      <div style={CARD}>
        {/* eyebrow */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10, fontWeight: 500, letterSpacing: ".14em",
          color: "#22c55e", textTransform: "uppercase", marginBottom: 28,
        }}>
          <div style={{ width: 24, height: 1, background: "#22c55e" }} />
          Release Intelligence System
        </div>

        <h1 style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: 44, fontWeight: 600, lineHeight: 1.08,
          letterSpacing: "-.01em", color: "#e8f0f8",
          margin: "0 0 10px",
        }}>
          Welcome <em style={{ fontStyle: "italic", fontWeight: 400, color: "#6e87a2" }}>back.</em>
        </h1>
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 15, fontWeight: 300, color: "#6e87a2",
          lineHeight: 1.6, marginBottom: 32,
        }}>
          Sign in to your workspace to continue.
        </p>

        {/* notices */}
        {resetNotice ? (
          <div role="status" style={{
            fontSize: 13, color: "#22c55e", marginBottom: 20, lineHeight: 1.5,
            borderLeft: "2px solid #22c55e", paddingLeft: 12,
            fontFamily: "'DM Sans', sans-serif",
          }}>
            {resetNotice}
          </div>
        ) : null}

        <div role="status" aria-live="polite" style={{ minHeight: 20, marginBottom: error || status ? 12 : 0 }}>
          {error ? (
            <div style={{ color: "#ef4444", fontSize: 13, fontFamily: "'DM Sans', sans-serif" }}>{error}</div>
          ) : status ? (
            <div style={{ color: "#384d60", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{status}</div>
          ) : null}
        </div>

        <form onSubmit={onSubmit} noValidate>
          {/* email */}
          <label htmlFor="login-email" style={LABEL}>Work email</label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            disabled={busy}
            style={{ ...INPUT, marginBottom: 16 }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#243050")}
            onBlur={(e)  => (e.currentTarget.style.borderColor = "#18243a")}
          />

          {/* password row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <label htmlFor="login-password" style={LABEL}>Password</label>
            <Link to="/forgot-password" style={{
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              color: "#384d60", textDecoration: "none",
            }}>
              Forgot?
            </Link>
          </div>
          <div style={{ position: "relative", marginBottom: 20 }}>
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={busy}
              style={{ ...INPUT, paddingRight: 52 }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#243050")}
              onBlur={(e)  => (e.currentTarget.style.borderColor = "#18243a")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              style={{
                position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                background: "transparent", border: "none",
                color: "#384d60", fontSize: 10, cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace", letterSpacing: ".06em",
              }}
              tabIndex={-1}
            >
              {showPassword ? "HIDE" : "SHOW"}
            </button>
          </div>

          {/* remember */}
          <label style={{
            display: "flex", alignItems: "center", gap: 10,
            fontSize: 13, fontFamily: "'DM Sans', sans-serif",
            color: "#384d60", marginBottom: 24, cursor: "pointer", userSelect: "none",
          }}>
            <input
              type="checkbox"
              checked={rememberEmail}
              onChange={(e) => setRememberEmail(e.target.checked)}
              disabled={busy}
            />
            Remember email on this device
          </label>

          {/* submit */}
          <button
            type="submit"
            disabled={busy}
            style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1, cursor: busy ? "not-allowed" : "pointer" }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p style={{ marginTop: 24, textAlign: "center" }}>
          <Link to="/request-access" style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12, color: "#384d60", textDecoration: "none",
            letterSpacing: ".02em",
          }}>
            Need an account? Join waitlist →
          </Link>
        </p>
      </div>
    </div>
  );
}
