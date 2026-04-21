/** Readable CSRF cookie name (must match backend CSRF_COOKIE_NAME default). */
const CSRF_COOKIE = "vdk_csrf";

export function getCsrfHeader() {
  if (typeof document === "undefined") return {};
  const raw = document.cookie.split(";").map((s) => s.trim());
  const prefix = `${CSRF_COOKIE}=`;
  for (const part of raw) {
    if (part.startsWith(prefix)) {
      return { "X-CSRF-Token": decodeURIComponent(part.slice(prefix.length)) };
    }
  }
  return {};
}
