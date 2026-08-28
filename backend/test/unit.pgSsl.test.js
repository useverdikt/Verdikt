"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  shouldUseSsl,
  sslConfig,
  stripSslQueryParams,
  loadSslCa,
  annotateDatabaseSslError
} = require("../src/db/pg");

describe("postgres TLS config", () => {
  const original = {
    DATABASE_SSL: process.env.DATABASE_SSL,
    DATABASE_SSL_REJECT_UNAUTHORIZED: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    DATABASE_SSL_CA: process.env.DATABASE_SSL_CA,
    DATABASE_SSL_CA_FILE: process.env.DATABASE_SSL_CA_FILE,
    NODE_ENV: process.env.NODE_ENV,
    REQUIRE_SECURE_CONFIG: process.env.REQUIRE_SECURE_CONFIG
  };

  beforeEach(() => {
    delete process.env.DATABASE_SSL;
    delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    delete process.env.DATABASE_SSL_CA;
    delete process.env.DATABASE_SSL_CA_FILE;
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

  it("auto-enables SSL for Supabase hosts and trusts the official Root 2021 CA", () => {
    const url = "postgresql://aws-0-eu.pooler.supabase.com:6543/postgres";
    assert.equal(shouldUseSsl(url), true);
    const cfg = sslConfig(url);
    assert.equal(cfg.rejectUnauthorized, true);
    assert.match(cfg.ca, /BEGIN CERTIFICATE/);
    assert.match(loadSslCa(url), /Supabase|BEGIN CERTIFICATE/);
  });

  it("uses DATABASE_SSL_CA over the bundled Supabase CA", () => {
    process.env.DATABASE_SSL_CA = "-----BEGIN CERTIFICATE-----\nCUSTOM\n-----END CERTIFICATE-----";
    const cfg = sslConfig("postgresql://aws-0-eu.pooler.supabase.com:6543/postgres");
    assert.match(cfg.ca, /CUSTOM/);
  });

  it("strips sslmode from the URL so pg cannot discard the ssl object", () => {
    const stripped = stripSslQueryParams(
      "postgresql://user:pass@aws-0-eu.pooler.supabase.com:6543/postgres?sslmode=require&schema=public"
    );
    assert.equal(stripped.includes("sslmode"), false);
    assert.match(stripped, /schema=public/);
  });

  it("annotates SELF_SIGNED_CERT_IN_CHAIN with an operator hint", () => {
    const err = Object.assign(new Error("self-signed certificate in certificate chain"), {
      code: "SELF_SIGNED_CERT_IN_CHAIN"
    });
    const wrapped = annotateDatabaseSslError(err);
    assert.match(wrapped.message, /DATABASE_SSL_CA/);
    assert.equal(wrapped.code, "SELF_SIGNED_CERT_IN_CHAIN");
  });
});
