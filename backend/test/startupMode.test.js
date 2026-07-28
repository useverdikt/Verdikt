"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { shouldStartBackgroundJobs } = require("../src/lib/startupMode");

describe("shouldStartBackgroundJobs", () => {
  const env = process.env;

  test("defaults to false in production", () => {
    const original = env.NODE_ENV;
    env.NODE_ENV = "production";
    delete env.RUN_BACKGROUND_JOBS;
    assert.equal(shouldStartBackgroundJobs(), false);
    env.NODE_ENV = original;
  });

  test("defaults to true in development/test", () => {
    const original = env.NODE_ENV;
    env.NODE_ENV = "test";
    delete env.RUN_BACKGROUND_JOBS;
    assert.equal(shouldStartBackgroundJobs(), true);
    env.NODE_ENV = original;
  });

  test("RUN_BACKGROUND_JOBS=1 overrides production default", () => {
    env.RUN_BACKGROUND_JOBS = "1";
    env.NODE_ENV = "production";
    assert.equal(shouldStartBackgroundJobs(), true);
    delete env.RUN_BACKGROUND_JOBS;
  });

  test("RUN_BACKGROUND_JOBS=0 overrides development default", () => {
    env.RUN_BACKGROUND_JOBS = "0";
    env.NODE_ENV = "development";
    assert.equal(shouldStartBackgroundJobs(), false);
    delete env.RUN_BACKGROUND_JOBS;
  });
});
