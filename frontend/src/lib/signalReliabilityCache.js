/**
 * Module-level cache for GET /api/workspaces/:id/signal-reliability.
 * Same pattern as loopReadinessCache — stale-while-revalidate, in-flight deduplication.
 */

const TTL_MS = 2 * 60 * 1000;

/** @type {Map<string, { data: object|null, fetchedAt: number, promise: Promise|null }>} */
const cache = new Map();

export function getCachedSignalReliability(wsId) {
  return cache.get(wsId)?.data ?? null;
}

export async function fetchSignalReliability(wsId, apiFetch) {
  if (!wsId) return null;

  const now = Date.now();
  const entry = cache.get(wsId);

  if (entry?.promise) return entry.promise;
  if (entry?.data && now - entry.fetchedAt < TTL_MS) return entry.data;

  const promise = apiFetch(`/api/workspaces/${wsId}/signal-reliability`)
    .then((data) => {
      cache.set(wsId, { data, fetchedAt: Date.now(), promise: null });
      return data;
    })
    .catch((err) => {
      const stale = cache.get(wsId);
      cache.set(wsId, { data: stale?.data ?? null, fetchedAt: stale?.fetchedAt ?? 0, promise: null });
      throw err;
    });

  cache.set(wsId, { data: entry?.data ?? null, fetchedAt: entry?.fetchedAt ?? 0, promise });
  return promise;
}

export function resetSignalReliabilityCache(wsId) {
  if (wsId) cache.delete(wsId);
  else cache.clear();
}
