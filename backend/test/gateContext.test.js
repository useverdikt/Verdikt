"use strict";

const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { getPool } = require("../src/db/pg");
const { buildGateContext } = require("../src/services/gateContext");

describe("gateContext fetch error propagation", () => {
  const pool = getPool();
  let originalQuery = null;

  afterEach(() => {
    if (originalQuery) {
      pool.query = originalQuery;
      originalQuery = null;
    }
  });

  test("throws when evidence fetch fails instead of returning empty context", async () => {
    originalQuery = pool.query.bind(pool);
    pool.query = async () => {
      throw new Error("database unavailable");
    };

    const release = { id: "rel_test", workspace_id: "ws_test", status: "CERTIFIED" };
    await assert.rejects(
      async () => buildGateContext(release, null),
      /database unavailable/
    );
  });

  test("returns context normally when evidence fetch succeeds", async () => {
    const release = { id: "rel_test", workspace_id: "ws_test", status: "UNCERTIFIED" };
    const result = await buildGateContext(release, null);
    assert.ok(result);
    assert.ok(typeof result === "object");
  });
});
