/**
 * Supabase browser client (anon key + RLS). Use when migrating off Express for a given feature.
 * Requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in env (e.g. Vercel).
 */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export function isSupabaseConfigured() {
  return !!(url && anonKey);
}
