/**
 * API origin for browser fetches. In Vite dev with empty base, requests are same-origin and proxied to the backend.
 *
 * Security: in production builds, `localStorage` overrides are ignored so a malicious value cannot
 * redirect JWT-bearing requests to an attacker-controlled origin (XSS / social engineering).
 */
export function getSafeApiBase() {
  const viteBase =
    typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE
      ? String(import.meta.env.VITE_API_BASE).trim()
      : "";
  const fallback = viteBase || "";
  const allowLsOverride =
    typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV === true;
  const raw = (allowLsOverride ? localStorage.getItem("vdk3_api_base") || fallback : fallback).trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return fallback || "";
    return u.origin.replace(/\/$/, "");
  } catch {
    return fallback || "";
  }
}
