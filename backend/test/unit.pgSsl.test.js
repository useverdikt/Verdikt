"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { shouldUseSsl, sslConfig } = require("../src/db/pg");

describe("postgres TLS config", () => {
  const original = {
    DATABASE_SSL: process.env.DATABASE_SSL,
    DATABASE_SSL_REJECT_UNAUTHORIZED: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    NODE_ENV: process.env.NODE_ENV,
    REQUIRE_SECURE_CONFIG: process.env.REQUIRE_SECURE_CONFIG
  };

  beforeEach(() => {
    delete process.env.DATABASE_SSL;
    delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    process.env.NODE_ENV = "test";
    delete process.env.REQUIRE_SECURE_CONFIG;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("validates TLS certificates when SSL is enabled", () => {
    process.env.DATABASE_SSL = "1";
    assert.deepEqual(sslConfig("postgresql://db.example/verdikt"), { rejectUnauthorized: true });
  });

  it("allows opting out of cert validation only outside production-like mode", () => {
    process.env.DATABASE_SSL = "1";
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "0";
    process.env.NODE_ENV = "development";
    assert.deepEqual(sslConfig("postgresql://db.example/verdikt"), { rejectUnauthorized: false });
  });

  it("refuses DATABASE_SSL_REJECT_UNAUTHORIZED=0 in production", () => {
    process.env.DATABASE_SSL = "1";
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "0";
    process.env.NODE_ENV = "production";
    assert.throws(() => sslConfig("postgresql://db.example/verdikt"), /DATABASE_SSL_REJECT_UNAUTHORIZED=0/);
  });

  it("auto-enables SSL for Supabase hosts", () => {
    assert.equal(shouldUseSsl("postgresql://aws-0-eu.pooler.supabase.com:6543/postgres"), true);
    assert.deepEqual(sslConfig("postgresql://aws-0-eu.pooler.supabase.com:6543/postgres"), {
      rejectUnauthorized: true
    });
  });
});
