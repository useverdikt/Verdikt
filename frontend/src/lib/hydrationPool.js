import { fetchAndMapReleaseDetail, fetchAndMapReleaseSummary } from "./releaseDetailApi.js";

const MAX_WORKERS = 6;
const MAX_FETCH_ATTEMPTS = 3;

const queue = [];
/** @type {Set<string>} keys like `rel_1:summary` or `rel_1:full` */
const inFlight = new Set();
/** @type {Set<string>} */
const hydrated = new Set();
/** @type {Map<string, number>} failed fetch attempts per cache key */
const failCounts = new Map();
/** @type {Map<string, object>} latest mapped release by backend id */
const resultCache = new Map();
/** @type {Map<string, Array<(v: object|null) => void>>} */
const pendingWaiters = new Map();

let workers = 0;
let onEach = null;
let navigate = null;
let generation = 0;

function cacheKey(id, full) {
  return `${id}:${full ? "full" : "summary"}`;
}

function waiterKey(id, full) {
  return cacheKey(id, full);
}

export function setHydrationNavigate(nav) {
  navigate = nav;
  drainPool();
}

export function setOnEach(fn) {
  onEach = fn;
}

function rejectAllWaiters() {
  for (const waiters of pendingWaiters.values()) {
    for (const resolve of waiters) resolve(null);
  }
  pendingWaiters.clear();
}

export function reset() {
  generation += 1;
  queue.length = 0;
  rejectAllWaiters();
  inFlight.clear();
  hydrated.clear();
  failCounts.clear();
  resultCache.clear();
}

export function syncHydratedFromReleases(releases, isPending) {
  if (!Array.isArray(releases) || typeof isPending !== "function") return;
  for (const release of releases) {
    const id = release?.backendReleaseId;
    if (!id) continue;
    if (!isPending(release)) {
      hydrated.add(cacheKey(id, false));
      if (release.detailLoaded) hydrated.add(cacheKey(id, true));
    }
  }
}

function settleWaiters(key, mapped) {
  const waiters = pendingWaiters.get(key);
  if (!waiters) return;
  pendingWaiters.delete(key);
  for (const resolve of waiters) resolve(mapped ?? null);
}

function addWaiter(key) {
  return new Promise((resolve) => {
    if (!pendingWaiters.has(key)) pendingWaiters.set(key, []);
    pendingWaiters.get(key).push(resolve);
  });
}

function clearHydrated(id) {
  hydrated.delete(cacheKey(id, true));
  hydrated.delete(cacheKey(id, false));
}

/**
 * @param {string[]} ids
 * @param {{ priority?: boolean, force?: boolean, full?: boolean }} opts
 */
export function enqueue(ids, { priority = false, force = false, full = false } = {}) {
  if (!ids?.length) return;

  if (force) {
    for (const id of ids) {
      clearHydrated(id);
      resultCache.delete(id);
      failCounts.delete(cacheKey(id, full));
    }
  }

  const keyFor = (id) => cacheKey(id, full);
  const pending = ids.filter(
    (id) => id && (force || !hydrated.has(keyFor(id))) && !inFlight.has(keyFor(id))
  );
  if (!pending.length) {
    drainPool();
    return;
  }

  const pendingSet = new Set(pending);
  const itemFor = (id) => ({ id, priority, full });

  if (priority) {
    const filtered = queue.filter((item) => !pendingSet.has(item.id));
    queue.splice(0, queue.length, ...pending.map(itemFor), ...filtered);
  } else {
    for (const id of pending) {
      const next = itemFor(id);
      if (!queue.some((item) => item.id === id && item.full === full)) {
        queue.push(next);
      }
    }
  }

  drainPool();
}

export async function awaitReleaseDetail(id, { priority = false, force = false, full = true } = {}) {
  if (!id) return null;
  const key = waiterKey(id, full);

  if (!force) {
    const cached = resultCache.get(id);
    if (full && cached?.detailLoaded) return cached;
    if (!full && cached?.summaryLoaded && hydrated.has(cacheKey(id, false))) return cached;
  }

  if (!force && inFlight.has(key)) {
    return addWaiter(key);
  }

  const waiter = addWaiter(key);
  enqueue([id], { priority, force, full });
  return waiter;
}

function drainPool() {
  const gen = generation;

  while (workers < MAX_WORKERS && queue.length) {
    const item = queue[0];
    if (!item?.id) {
      queue.shift();
      continue;
    }

    const key = cacheKey(item.id, item.full);
    if (hydrated.has(key) || inFlight.has(key)) {
      queue.shift();
      continue;
    }
    if (!navigate) return;

    queue.shift();
    inFlight.add(key);
    workers += 1;

    const { id, full } = item;
    const fetchFn = full ? fetchAndMapReleaseDetail : fetchAndMapReleaseSummary;

    fetchFn(id, navigate)
      .then((mapped) => mapped, () => null)
      .then((mapped) => {
        if (gen !== generation) return;
        inFlight.delete(key);
        if (mapped) {
          failCounts.delete(key);
          hydrated.add(key);
          if (full) hydrated.add(cacheKey(id, false));
          resultCache.set(id, mapped);
          onEach?.(mapped);
          settleWaiters(key, mapped);
          return;
        }

        const attempts = (failCounts.get(key) || 0) + 1;
        failCounts.set(key, attempts);
        if (attempts < MAX_FETCH_ATTEMPTS) {
          queue.unshift({ id, priority: true, full });
          drainPool();
          return;
        }

        failCounts.delete(key);
        settleWaiters(key, null);
      })
      .finally(() => {
        workers -= 1;
        if (gen === generation) drainPool();
      });
  }
}

export function _peekQueueIdsForTests() {
  return queue.map((item) => item.id);
}

export function _resetHydrationPoolForTests() {
  reset();
  workers = 0;
  onEach = null;
  navigate = null;
  generation = 0;
}
