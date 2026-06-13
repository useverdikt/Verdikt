/**
 * Stale-while-revalidate workspace resource cache with in-flight deduplication.
 */

export function createWorkspaceResourceCache({ pathFor, ttlMs = 2 * 60 * 1000 } = {}) {
  if (typeof pathFor !== "function") {
    throw new Error("createWorkspaceResourceCache requires pathFor(wsId)");
  }

  /** @type {Map<string, { data: object|null, fetchedAt: number, promise: Promise|null }>} */
  const cache = new Map();

  function getCached(wsId) {
    return cache.get(wsId)?.data ?? null;
  }

  async function fetch(wsId, apiFetch) {
    if (!wsId) return null;

    const now = Date.now();
    const entry = cache.get(wsId);

    if (entry?.promise) return entry.promise;
    if (entry?.data && now - entry.fetchedAt < ttlMs) return entry.data;

    const promise = apiFetch(pathFor(wsId))
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

  function reset(wsId) {
    if (wsId) cache.delete(wsId);
    else cache.clear();
  }

  return { getCached, fetch, reset };
}
