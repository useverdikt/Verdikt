import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getSafeApiBase } from "../../lib/apiBase.js";
import { apiPost } from "../../lib/apiClient.js";
import { persistAuthSession } from "../../auth/persistSession.js";

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Missing invite token.");
      setLoaded(true);
      return;
    }
    const API_BASE = getSafeApiBase();
    fetch(`${API_BASE}/api/auth/invite/${encodeURIComponent(token)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setError(d.error === "expired" ? "This invite has expired." : "Invite not found.");
          return;
        }
        setPreview(d);
      })
      .catch(() => setError("Could not load invite."))
      .finally(() => setLoaded(true));
  }, [token]);

  const acceptInvite = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const out = await apiPost("/api/auth/accept-invite", { token });
      if (out?.user) persistAuthSession({ user: out.user });
      navigate("/app", { replace: true });
    } catch (e) {
      const msg = String(e?.message || "");
      if (msg.includes("401") || msg.toLowerCase().includes("authentication")) {
        navigate(`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`, { replace: true });
        return;
      }
      setError(msg || "Could not accept invite.");
    } finally {
      setBusy(false);
    }
  }, [navigate, token]);

  useEffect(() => {
    if (!loaded || !preview) return;
    let hasSession = false;
    try {
      hasSession = Boolean(localStorage.getItem("vdk3_currentUser"));
    } catch (_) {
      /* ignore */
    }
    if (hasSession) void acceptInvite();
  }, [acceptInvite, loaded, preview]);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Join workspace</h1>
        {preview ? (
          <p style={{ color: "#6e87a2", marginBottom: 16 }}>
            {preview.inviter_name ? `${preview.inviter_name} invited ` : "You've been invited: "}
            <strong>{preview.email}</strong> as <strong>{preview.role}</strong>
          </p>
        ) : null}
        {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
        {busy ? <p style={{ color: "#6e87a2" }}>Accepting invite…</p> : null}
        {loaded && !busy && !error && preview && !localStorage.getItem("vdk3_currentUser") ? (
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
            <Link to={`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}>Sign in to accept</Link>
            <Link to={`/onboarding?invite=${encodeURIComponent(token)}`}>Create account</Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
