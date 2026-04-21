import { getSafeApiBase } from "./apiBase.js";

export function hasBackend() {
  const b = getSafeApiBase();
  if (b === "" && typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV) return true;
  return !!(b && b.startsWith("http"));
}
