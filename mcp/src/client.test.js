import { test } from "node:test";
import assert from "node:assert/strict";
import { VerdiktApiError } from "./client.js";

test("VerdiktApiError preserves structured API body", () => {
  const err = new VerdiktApiError(409, {
    error: "release_verdict_locked",
    action: "collecting",
    blocking_signals: ["accuracy"],
    status: "COLLECTING"
  });
  assert.equal(err.name, "VerdiktApiError");
  assert.equal(err.status, 409);
  assert.equal(err.data.action, "collecting");
  assert.deepEqual(err.data.blocking_signals, ["accuracy"]);
  assert.match(String(err.message), /409/);
  assert.match(String(err.message), /release_verdict_locked/);
});

test("VerdiktApiError handles non-object payloads", () => {
  const err = new VerdiktApiError(502, null);
  assert.equal(err.status, 502);
  assert.equal(err.data.raw, null);
});
