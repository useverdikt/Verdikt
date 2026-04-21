import { supabase } from "../lib/supabaseClient.js";
import { getSafeApiBase } from "../lib/apiBase.js";
import { persistAuthSession } from "./persistSession.js";

/**
 * Set Express HttpOnly session cookies from Supabase access_token (POST /api/auth/session-from-supabase).
 * Backend must have SUPABASE_JWT_SECRET and a matching row in Postgres (DATABASE_URL) or SQLite (auth_user_id / id).
 * @param {import("@supabase/supabase-js").Session} session
 * @returns {Promise<{ user: object }>}
 */
export async function exchangeSupabaseSessionForExpressCookies(session) {
  const base = getSafeApiBase();
  const url = `${base}/api/auth/session-from-supabase`;
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: session.access_token })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : `Session exchange failed (${res.status})`;
    throw new Error(msg);
  }
  if (!data.user) throw new Error("Session exchange returned no user");
  return data;
}

/**
 * Mirror Supabase session into the SPA and Express cookie session so /api/* routes work.
 * @param {import("@supabase/supabase-js").Session} session
 */
export async function persistSessionFromSupabaseSession(session) {
  if (!supabase || !session?.user) {
    throw new Error("No Supabase session");
  }
  const { user } = await exchangeSupabaseSessionForExpressCookies(session);
  persistAuthSession({ user });
}

export async function signInWithSupabase(email, password) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });
  if (error) throw error;
  if (data.session) await persistSessionFromSupabaseSession(data.session);
  return data;
}

export async function signOutSupabase() {
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore */
  }
}
