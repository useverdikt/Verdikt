import { fetchAndMapReleaseDetail } from "./releaseDetailApi.js";

const MAX_WORKERS = 6;

const queue = [];
const inFlight = new Set();
const hydrated = new Set();
const resultCache = new Map();
const pendingWaiters = new Map();

let workers = 0;
let onEach = null;
let navigate = null;
let generation = 0;

export function setHydrationNavigate(nav) {
  navigate = nav;
  drainPool();
}

export function setOnEach(fn) {
  onEach = fn;
}

/** Clear queue and hydrated state (logout / workspace switch). */
export function reset() {
  generation += 1;
  queue.length = 0;
  inFlight.clear();
  hydrated.clear();
  resultCache.clear();
  pendingWaiters.clear();
}

export function syncHydratedFromReleases(releases, isPending) {
  if (!Array.isArray(releases) || typeof isPending !== "function") return;
  for (const release of releases) {
    const id = release?.backendReleaseId;
    if (id && !isPending(release)) {
      hydrated.add(id);
    }
  }
}

function markHydrated(id, mapped) {
  hydrated.add(id);
  inFlight.delete(id);
  if (mapped) resultCache.set(id, mapped);
}

function settleWaiters(id, mapped) {
  const waiters = pendingWaiters.get(id);
  if (!waiters) return;
  pendingWaiters.delete(id);
  for (const resolve of waiters) resolve(mapped ?? null);
}

function addWaiter(id) {
  return new Promise((resolve) => {
    if (!pendingWaiters.has(id)) pendingWaiters.set(id, []);
    pendingWaiters.get(id).push(resolve);
  });
}

/**
 * @param {string[]} ids
 * @param {{ priority?: boolean, force?: boolean }} opts
 */
export function enqueue(ids, { priority = false, force = false } = {}) {
  if (!ids?.length) return;

  if (force) {
    for (const id of ids) {
      hydrated.delete(id);
      resultCache.delete(id);
    }
  }

  const pending = ids.filter(
    (id) => id && (force || !hydrated.has(id)) && !inFlight.has(id)
  );
  if (!pending.length) {
    drainPool();
    return;
  }

  const pendingSet = new Set(pending);

  if (priority) {
    const filtered = queue.filter((item) => !pendingSet.has(item.id));
    queue.splice(
      0,
      queue.length,
      ...pending.map((id) => ({ id, priority: true })),
      ...filtered
    );
  } else {
    for (const id of pending) {
      if (!queue.some((item) => item.id === id)) {
        queue.push({ id, priority: false });
      }
    }
  }

  drainPool();
}

/** Await a single release detail (expand, refresh, audit). Shares the global pool. */
export async function awaitReleaseDetail(id, { priority = false, force = false } = {}) {
  if (!id) return null;
  if (!force && hydrated.has(id) && resultCache.has(id)) {
    return resultCache.get(id);
  }
  if (!force && inFlight.has(id)) {
    return addWaiter(id);
  }

  const waiter = addWaiter(id);
  enqueue([id], { priority, force });
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
    if (hydrated.has(item.id) || inFlight.has(item.id)) {
      queue.shift();
      continue;
    }
    if (!navigate) return;

    queue.shift();

    inFlight.add(item.id);
    workers += 1;
    const id = item.id;

    fetchAndMapReleaseDetail(id, navigate)
      .then((mapped) => {
        if (gen !== generation) return;
        inFlight.delete(id);
        if (mapped) {
          markHydrated(id, mapped);
          onEach?.(mapped);
          settleWaiters(id, mapped);
        } else {
          settleWaiters(id, null);
        }
      })
      .catch(() => {
        if (gen !== generation) return;
        inFlight.delete(id);
        settleWaiters(id, null);
      })
      .finally(() => {
        workers -= 1;
        if (gen === generation) drainPool();
      });
  }
}

/** Test-only: inspect pending queue order. */
export function _peekQueueIdsForTests() {
  return queue.map((item) => item.id);
}

/** Test-only: reset pool and worker accounting. */
export function _resetHydrationPoolForTests() {
  reset();
  workers = 0;
  onEach = null;
  navigate = null;
  generation = 0;
}
