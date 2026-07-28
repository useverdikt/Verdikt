"use strict";

/**
 * Guard: authenticated HTTP error responses should go through sendError / errorBody
 * rather than ad-hoc `{ error: "..." }` JSON (except intentional non-error shapes).
 */

const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const SRC_ROOT = path.join(__dirname, "..", "src");

/** Paths allowed to keep legacy / non-HTTP-error `{ error }` payloads. */
const ALLOWLIST = new Set([
  // GitHub webhook ACK returns HTTP 200 with ok:false — not the API error contract
  "lib/githubWebhookAck.js"
]);

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (ent.isFile() && ent.name.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("API error contract usage", () => {
  it("route/middleware files do not ad-hoc res.status().json({ error })", () => {
    const offenders = [];
    for (const abs of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, abs).split(path.sep).join("/");
      if (ALLOWLIST.has(rel)) continue;
      if (rel === "lib/apiError.js") continue;
      const src = fs.readFileSync(abs, "utf8");
      if (/res\.status\([^)]+\)\.json\(\s*\{\s*error\s*:/.test(src)) {
        offenders.push(rel);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Use sendError(res, req, status, ...) instead of ad-hoc error JSON:\n${offenders.join("\n")}`
    );
  });
});
