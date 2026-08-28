"use strict";

process.env.NODE_ENV = "test";

const { describe, it, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { authenticatePassword } = require("../src/lib/loginPassword");

describe("login password timing", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("still runs bcrypt.compare when the user is missing", async () => {
    const spy = mock.method(bcrypt, "compare", async () => false);
    const ok = await authenticatePassword("guess", null);
    assert.equal(ok, false);
    assert.equal(spy.mock.callCount(), 1);
  });

  it("succeeds only when a user row exists and the hash matches", async () => {
    mock.method(bcrypt, "compare", async () => true);
    assert.equal(await authenticatePassword("pw", { password_hash: "hash" }), true);
    assert.equal(await authenticatePassword("pw", null), false);
  });
});
