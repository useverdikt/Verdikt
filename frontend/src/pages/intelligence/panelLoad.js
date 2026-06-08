/** User-facing message from a failed Intelligence Hub panel fetch. */
export function panelErrorMessage(err, fallback = "Could not load data. Check your connection and try again.") {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err.trim();
  return fallback;
}
