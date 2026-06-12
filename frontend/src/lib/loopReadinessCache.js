/**
 * Module-level cache for GET /api/workspaces/:id/loop-readiness.
 *
 * Properties:
 * - Shows cached data immediately on every call (stale-while-revalidate).
 * - Dedupes concurrent requests for the same workspace — only one in-flight fetch.
 * - Short TTL (2 min) so data stays reasonably fresh without hammering a slow endpoint.
 * - reset() on logout/workspace switch so stale data doesn't bleed across sessions.
 */

const TTL_MS = 2 * 60 * 1000;

/** @type {Map<string, { data: object|null, fetchedAt: number, promise: Promise|null }>} */
const cache = new Map();

/** Return cached data instantly, or null if nothing cached yet. */
export function getCachedLoopReadiness(wsId) {
  return cache.get(wsId)?.data ?? null;
}

/**
 * Fetch loop-readiness, deduping in-flight requests and respecting the cache TTL.
 * @param {string} wsId
 * @param {(path: string) => Promise<object>} apiFetch  — e.g. apiGet
 * @returns {Promise<object|null>}
 */
export async function fetchLoopReadiness(wsId, apiFetch) {
  if (!wsId) return null;

  const now = Date.now();
  const entry = cache.get(wsId);

  // Return in-flight promise (dedupe concurrent callers).
  if (entry?.promise) return entry.promise;

  // Return cache hit if still fresh.
  if (entry?.data && now - entry.fetchedAt < TTL_MS) return entry.data;

  const promise = apiFetch(`/api/workspaces/${wsId}/loop-readiness`)
    .then((data) => {
      cache.set(wsId, { data, fetchedAt: Date.now(), promise: null });
      return data;
    })
    .catch((err) => {
      // Clear promise so next call retries; preserve stale data for display.
      const stale = cache.get(wsId);
      cache.set(wsId, { data: stale?.data ?? null, fetchedAt: stale?.fetchedAt ?? 0, promise: null });
      throw err;
    });

  // Store the in-flight promise; keep any stale data so callers can show it.
  cache.set(wsId, { data: entry?.data ?? null, fetchedAt: entry?.fetchedAt ?? 0, promise });
  return promise;
}

/** Clear cache on logout or workspace switch. */
export function resetLoopReadinessCache(wsId) {
  if (wsId) cache.delete(wsId);
  else cache.clear();
}
