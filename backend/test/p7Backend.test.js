"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { enqueuePostVerdictEffects, runPostVerdictEffects } = require("../src/services/postVerdictEffects");
const { fetchIntegrationSignals } = require("../src/services/signalIngestFromSources");

describe("enqueuePostVerdictEffects", () => {
  it("exports async enqueue helper alongside runPostVerdictEffects", () => {
    assert.equal(typeof enqueuePostVerdictEffects, "function");
    assert.equal(typeof runPostVerdictEffects, "function");
  });

  it("returns immediately without awaiting heavy effects", () => {
    const start = Date.now();
    enqueuePostVerdictEffects(
      "rel_enqueue_test",
      { id: "rel_enqueue_test", workspace_id: "ws_test" },
      "COLLECTING",
      [],
      null
    );
    assert.ok(Date.now() - start < 25);
  });
});

describe("fetchIntegrationSignals", () => {
  it("marks unknown connector ids as unsupported without throwing", async () => {
    const out = await fetchIntegrationSignals(
      { source_id: "unknown_vendor", api_key: "", extra_json: null },
      { id: "rel_1", workspace_id: "ws_1", version: "v1" },
      { version: "v1", commit_sha: null, github_repo: null }
    );
    assert.equal(out.sid, "unknown_vendor");
    assert.equal(out.matched, false);
    assert.equal(out.error, "unsupported_source");
  });
});
