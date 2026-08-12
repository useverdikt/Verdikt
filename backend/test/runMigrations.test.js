"use strict";

process.env.NODE_ENV = "test";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MIGRATION_LOCK_KEYS,
  runMigrations
} = require("../src/database/runMigrations");

function createHarness() {
  const state = {
    applied: new Set(),
    events: [],
    lockOwner: null,
    waiters: [],
    nextClientId: 1,
    migrationExecutions: 0,
    failNextMigration: false,
    failUnlock: false,
    releases: []
  };

  function acquireLock(clientId) {
    if (state.lockOwner == null) {
      state.lockOwner = clientId;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      state.waiters.push({ clientId, resolve });
    });
  }

  function releaseLock(clientId) {
    if (state.lockOwner !== clientId) return false;
    const next = state.waiters.shift();
    if (next) {
      state.lockOwner = next.clientId;
      next.resolve();
    } else {
      state.lockOwner = null;
    }
    return true;
  }

  const pool = {
    async connect() {
      const clientId = state.nextClientId;
      state.nextClientId += 1;
      return {
        async query(sql, params = []) {
          const normalized = String(sql).trim();
          if (normalized.startsWith("SELECT pg_advisory_lock")) {
            assert.deepEqual(params, MIGRATION_LOCK_KEYS);
            state.events.push(`wait:${clientId}`);
            await acquireLock(clientId);
            state.events.push(`acquired:${clientId}`);
            return { rows: [{ pg_advisory_lock: null }] };
          }
          if (normalized.startsWith("SELECT pg_advisory_unlock")) {
            assert.deepEqual(params, MIGRATION_LOCK_KEYS);
            if (state.failUnlock) throw new Error("simulated unlock failure");
            const unlocked = releaseLock(clientId);
            state.events.push(`unlocked:${clientId}`);
            return { rows: [{ unlocked }] };
          }
          if (normalized.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) {
            state.events.push(`table:${clientId}`);
            return { rows: [] };
          }
          if (normalized === "SELECT name FROM schema_migrations") {
            return { rows: [...state.applied].map((name) => ({ name })) };
          }
          if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
            state.events.push(`${normalized.toLowerCase()}:${clientId}`);
            return { rows: [] };
          }
          if (normalized.startsWith("INSERT INTO schema_migrations")) {
            const [name] = params;
            if (state.applied.has(name)) throw new Error(`duplicate migration ${name}`);
            state.applied.add(name);
            return { rows: [] };
          }
          if (normalized === "SELECT 1;") {
            state.migrationExecutions += 1;
            state.events.push(`migration:${clientId}`);
            if (state.failNextMigration) {
              state.failNextMigration = false;
              throw new Error("simulated migration failure");
            }
            return { rows: [{ "?column?": 1 }] };
          }
          throw new Error(`Unexpected SQL: ${normalized}`);
        },
        release(destroy = false) {
          state.releases.push({ clientId, destroy });
        }
      };
    }
  };

  const fsImpl = {
    existsSync: () => true,
    readdirSync: () => ["001_test.sql"],
    readFileSync: () => "SELECT 1;"
  };
  const logger = { log() {}, warn() {} };

  return { state, pool, fsImpl, logger };
}

describe("runMigrations", () => {
  it("serializes concurrent startup runners before reading applied migrations", async () => {
    const harness = createHarness();
    const options = {
      pool: harness.pool,
      fsImpl: harness.fsImpl,
      migrationsDir: "/test/migrations",
      nowFn: () => "2026-08-12T12:00:00.000Z",
      logger: harness.logger
    };

    await Promise.all([runMigrations(options), runMigrations(options)]);

    assert.equal(harness.state.migrationExecutions, 1);
    assert.deepEqual([...harness.state.applied], ["001_test"]);
    assert.deepEqual(harness.state.releases, [
      { clientId: 1, destroy: false },
      { clientId: 2, destroy: false }
    ]);
    assert.ok(
      harness.state.events.indexOf("unlocked:1") <
        harness.state.events.indexOf("acquired:2")
    );
  });

  it("releases the advisory lock after a migration fails", async () => {
    const harness = createHarness();
    harness.state.failNextMigration = true;
    const options = {
      pool: harness.pool,
      fsImpl: harness.fsImpl,
      migrationsDir: "/test/migrations",
      nowFn: () => "2026-08-12T12:00:00.000Z",
      logger: harness.logger
    };

    await assert.rejects(
      () => runMigrations(options),
      /Migration 001_test\.sql failed: simulated migration failure/
    );
    await runMigrations(options);

    assert.equal(harness.state.migrationExecutions, 2);
    assert.deepEqual([...harness.state.applied], ["001_test"]);
    assert.deepEqual(
      harness.state.events.filter((event) => event.startsWith("unlocked:")),
      ["unlocked:1", "unlocked:2"]
    );
  });

  it("destroys a pooled connection when lock release cannot be confirmed", async () => {
    const harness = createHarness();
    harness.state.failUnlock = true;

    await runMigrations({
      pool: harness.pool,
      fsImpl: harness.fsImpl,
      migrationsDir: "/test/migrations",
      nowFn: () => "2026-08-12T12:00:00.000Z",
      logger: harness.logger
    });

    assert.deepEqual(harness.state.releases, [{ clientId: 1, destroy: true }]);
  });
});
