import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getSafeApiBase } from "../lib/apiBase.js";
import { VerdiktMark } from "../components/brand/VerdiktMark.jsx";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tokenFromQuery = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Verdikt — Set new password";
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const t = tokenFromQuery.trim();
    if (!t) {
      setError("This link is missing a reset token. Open the link from your email or paste the full URL.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const API_BASE = getSafeApiBase();
    setStatus(`Connecting to ${API_BASE || "(same-origin)"}…`);
    try {
      const body = JSON.stringify({ token: t, password });
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("");
        setError(typeof data.error === "string" ? data.error : "Could not reset password");
        setBusy(false);
        return;
      }
      setStatus("");
      navigate("/login", { replace: true, state: { resetNotice: data.message || "Password updated." } });
    } catch (err) {
      setStatus("");
      setError(`Cannot reach the API. Is the backend running? (${String(err?.message || err)})`);
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
          New <em style={{ fontStyle:"italic", fontWeight:400, color:"#6e87a2" }}>password.</em>
        </h1>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:15, fontWeight:300, color:"#6e87a2", lineHeight:1.6, marginBottom:28 }}>
          Choose a strong password. After saving, sign in with the new credentials.
        </p>
        <div role="status" aria-live="polite" style={{ minHeight:20, marginBottom: error || status ? 12 : 0 }}>
          {error ? <div style={{ color:"#ef4444", fontSize:13 }}>{error}</div>
            : status ? <div style={{ color:"#384d60", fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>{status}</div>
            : null}
        </div>
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="reset-password" style={{ display:"block", fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:500, letterSpacing:".1em", textTransform:"uppercase", color:"#384d60", marginBottom:8 }}>New password</label>
          <div style={{ position:"relative", marginBottom:14 }}>
            <input id="reset-password" type={showPassword?"text":"password"} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" disabled={busy} style={{ ...S_INPUT, paddingRight:52 }} />
            <button type="button" onClick={() => setShowPassword((s) => !s)} tabIndex={-1} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"transparent", border:"none", color:"#384d60", fontSize:10, cursor:"pointer", fontFamily:"'JetBrains Mono',monospace", letterSpacing:".06em" }}>
              {showPassword ? "HIDE" : "SHOW"}
            </button>
          </div>
          <label htmlFor="reset-confirm" style={{ display:"block", fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:500, letterSpacing:".1em", textTransform:"uppercase", color:"#384d60", marginBottom:8 }}>Confirm password</label>
          <input id="reset-confirm" type={showPassword?"text":"password"} required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" autoComplete="new-password" disabled={busy} style={{ ...S_INPUT, marginBottom:20 }} />
          <button type="submit" disabled={busy} style={{ ...S_BTN, opacity:busy?0.6:1, cursor:busy?"not-allowed":"pointer" }}>
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>
        <p style={{ marginTop:24, textAlign:"center" }}>
          <Link to="/login" style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:"#384d60", textDecoration:"none" }}>← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
