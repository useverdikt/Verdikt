"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const BACKEND_DIR = path.resolve(__dirname, "..");

async function waitForWorkerLog(child, timeoutMs = 10000) {
  const start = Date.now();
  let buffer = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("worker did not log health server port in time"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/health server listening on http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });

    child.stderr.on("data", (chunk) => {
      buffer += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`worker exited with code ${code}: ${buffer}`));
      }
    });
  });
}

async function fetchHealth(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on("error", reject);
  });
}

describe("worker health readiness", () => {
  test("exposes health endpoints and reports jobs started", async () => {
    const child = spawn("node", ["src/worker.js"], {
      cwd: BACKEND_DIR,
      env: { ...process.env, WORKER_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let port;
    try {
      port = await waitForWorkerLog(child, 10000);
      const live = await fetchHealth(port, "/health");
      assert.equal(live.status, 200);
      assert.equal(live.body.ok, true);
      assert.equal(live.body.service, "verdikt-worker");
      assert.equal(live.body.checks.jobs_started, true);
      assert.equal(live.body.checks.database, true);

      const ready = await fetchHealth(port, "/health/ready");
      assert.equal(ready.status, 200);
      assert.equal(ready.body.ok, true);
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.on("exit", resolve));
    }
  });
});
