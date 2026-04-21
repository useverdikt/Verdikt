import React, { useCallback, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getSafeApiBase } from "../lib/apiBase.js";
import { apiFetchInit } from "../lib/apiClient.js";
import { clearAuthSession, isAuthenticated } from "./session.js";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { persistSessionFromSupabaseSession, signOutSupabase } from "./supabaseAuth.js";

/**
 * Valid session: Supabase JWT + public.users row, or Express cookie/Bearer verified via GET /api/auth/me.
 */
async function verifyExpressSession() {
  const base = getSafeApiBase();
  let res;
  try {
    res = await fetch(`${base}/api/auth/me`, apiFetchInit());
  } catch {
    return "network";
  }
  if (res.status === 401 || res.status === 403) return "invalid";
  if (!res.ok) return "error";
  return "ok";
}

async function verifySupabaseSession() {
  if (!supabase) return "invalid";
  const {
    data: { session },
    error
  } = await supabase.auth.getSession();
  if (error) return "invalid";
  if (!session) return "invalid";
  try {
    await persistSessionFromSupabaseSession(session);
    return "ok";
  } catch {
    return "invalid";
  }
}

export default function ProtectedRoute({ children }) {
  const location = useLocation();
  const [phase, setPhase] = useState(() => {
    if (isSupabaseConfigured()) return "checking";
    return isAuthenticated() ? "checking" : "anon";
  });

  const runCheck = useCallback(async () => {
    if (isSupabaseConfigured() && supabase) {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      if (!session) {
        await signOutSupabase();
        clearAuthSession();
        setPhase("anon");
        return;
      }
      setPhase("checking");
      const result = await verifySupabaseSession();
      if (result === "invalid") {
        await signOutSupabase();
        clearAuthSession();
        setPhase("anon");
        return;
      }
      setPhase("authed");
      return;
    }

    if (!isAuthenticated()) {
      setPhase("anon");
      return;
    }
    setPhase("checking");
    const result = await verifyExpressSession();
    if (result === "invalid") {
      clearAuthSession();
      setPhase("anon");
      return;
    }
    if (result === "network" || result === "error") {
      setPhase("error");
      return;
    }
    setPhase("authed");
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  if (phase === "anon") {
    return (
      <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
    );
  }
  if (phase === "checking") {
    return (
      <div className="auth-session-gate" role="status" aria-live="polite" aria-busy="true">
        <div className="auth-session-gate-inner">
          <div className="auth-session-spinner" aria-hidden="true" />
          <p>Verifying session…</p>
        </div>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="auth-session-gate" role="alert">
        <div className="auth-session-gate-inner">
          <p>Can’t reach the server to verify your session.</p>
          <button type="button" className="auth-session-retry" onClick={() => void runCheck()}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  return children;
}
