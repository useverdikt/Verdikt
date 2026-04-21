import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSafeApiBase } from "../lib/apiBase.js";
import { VerdiktMark } from "../components/brand/VerdiktMark.jsx";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [devToken, setDevToken] = useState(null);
  const [devExpires, setDevExpires] = useState(null);

  useEffect(() => {
    document.title = "Verdikt — Forgot password";
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    const API_BASE = getSafeApiBase();
    setStatus(`Connecting to ${API_BASE || "(same-origin)"}…`);
    try {
      const body = JSON.stringify({ email: trimmed });
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setStatus("");
        setError(typeof data.error === "string" ? data.error : "Too many requests.");
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setStatus("");
        setError(typeof data.error === "string" ? data.error : "Request failed");
        setBusy(false);
        return;
      }
      setStatus("");
      setDone(true);
      if (typeof data.reset_token === "string" && data.reset_token) {
        setDevToken(data.reset_token);
        setDevExpires(typeof data.reset_expires_at === "string" ? data.reset_expires_at : null);
      }
    } catch (err) {
      setStatus("");
      setError(`Cannot reach the API. Is the backend running? (${String(err?.message || err)})`);
    } finally {
      setBusy(false);
    }
  };

  const S_ROOT = { minHeight:"100vh", background:"#060810", color:"#c4d4e8", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"'DM Sans',system-ui,sans-serif" };
  const S_CARD = { width:"100%", maxWidth:420, background:"#090d14", border:"1px solid #18243a", borderRadius:14, padding:"40px 40px 36px" };
  const S_INPUT = { width:"100%", padding:"12px 16px", borderRadius:7, border:"1px solid #18243a", background:"#060810", color:"#c4d4e8", fontSize:14, fontFamily:"'DM Sans',sans-serif", outline:"none" };
  const S_BTN = { width:"100%", background:"#c4d4e8", color:"#060810", border:"none", borderRadius:7, padding:13, fontSize:13, fontWeight:500, fontFamily:"'JetBrains Mono',monospace", letterSpacing:".04em" };

  return (
    <div style={S_ROOT}>
      <header style={{ position:"fixed", top:0, left:0, right:0, padding:"20px 40px", display:"flex", alignItems:"center", zIndex:10 }}>
        <Link to="/" style={{ display:"flex", alignItems:"center", gap:10, textDecoration:"none" }}>
          <span style={{ lineHeight:0, display:"flex" }}>
            <VerdiktMark size={32} variant="onDark" />
          </span>
          <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:17, fontWeight:600, color:"#c4d4e8", letterSpacing:"-.02em" }}>Verdikt</span>
        </Link>
      </header>
      <div style={S_CARD}>
        <div style={{ display:"flex", alignItems:"center", gap:10, fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:500, letterSpacing:".14em", color:"#22c55e", textTransform:"uppercase", marginBottom:28 }}>
          <div style={{ width:24, height:1, background:"#22c55e" }} />Release Intelligence System
        </div>
        <h1 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:40, fontWeight:600, lineHeight:1.08, letterSpacing:"-.01em", color:"#e8f0f8", margin:"0 0 10px" }}>
          Forgot <em style={{ fontStyle:"italic", fontWeight:400, color:"#6e87a2" }}>password.</em>
        </h1>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:15, fontWeight:300, color:"#6e87a2", lineHeight:1.6, marginBottom:28 }}>
          Enter your work email. We&apos;ll send reset instructions if an account exists.
        </p>
        <div role="status" aria-live="polite" style={{ minHeight:20, marginBottom: error || status ? 12 : 0 }}>
          {error ? <div style={{ color:"#ef4444", fontSize:13 }}>{error}</div>
            : status ? <div style={{ color:"#384d60", fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>{status}</div>
            : null}
        </div>
        {!done ? (
          <form onSubmit={onSubmit} noValidate>
            <label htmlFor="forgot-email" style={{ display:"block", fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:500, letterSpacing:".1em", textTransform:"uppercase", color:"#384d60", marginBottom:8 }}>Work email</label>
            <input id="forgot-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" disabled={busy} style={{ ...S_INPUT, marginBottom:20 }} />
            <button type="submit" disabled={busy} style={{ ...S_BTN, opacity:busy?0.6:1, cursor:busy?"not-allowed":"pointer" }}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        ) : (
          <div>
            <p style={{ color:"#6e87a2", fontSize:14, lineHeight:1.65, marginBottom:20 }}>
              If an account exists for that email, you&apos;ll receive reset instructions shortly.
            </p>
            {devToken ? (
              <div style={{ marginBottom:20, padding:16, borderRadius:8, border:"1px solid rgba(245,158,11,.2)", background:"rgba(245,158,11,.06)", fontSize:12, color:"#f59e0b" }}>
                <strong style={{ display:"block", marginBottom:8 }}>Dev / local only</strong>
                The API returned a reset token (set <code style={{ color:"#fde68a" }}>PASSWORD_RESET_RETURN_TOKEN=1</code>).
                {devExpires ? <span style={{ display:"block", marginTop:6, color:"#6e87a2" }}>Expires: {devExpires}</span> : null}
                <Link to={`/reset-password?token=${encodeURIComponent(devToken)}`} style={{ display:"inline-block", marginTop:12, color:"#22c55e", fontFamily:"'JetBrains Mono',monospace", fontSize:12 }}>
                  Open reset page →
                </Link>
              </div>
            ) : null}
          </div>
        )}
        <p style={{ marginTop:28, paddingTop:24, borderTop:"1px solid #18243a", textAlign:"center" }}>
          <Link to="/login" style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"#384d60", textDecoration:"none" }}>← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
