/** Match `/releases?release=<backendId>` against list rows (UI id is `rc-…`). */
export function matchReleaseByQueryId(releases, queryId) {
  const id = String(queryId || "").trim();
  if (!id) return null;
  return (releases || []).find((r) => r.backendReleaseId === id || r.id === id) || null;
}

export function readReleaseFocusId(searchParams) {
  const raw = typeof searchParams?.get === "function" ? searchParams.get("release") : searchParams?.release;
  const id = String(raw || "").trim();
  return id || null;
}
