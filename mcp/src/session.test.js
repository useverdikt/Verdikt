import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bindReleaseSession,
  clearReleaseSessionsForTests,
  ensureSessionId,
  generateAgentSessionId,
  normalizeSessionId,
  resolveSessionId
} from "./session.js";

test("generateAgentSessionId matches as_ prefix pattern", () => {
  const id = generateAgentSessionId();
  assert.match(id, /^as_[a-zA-Z0-9_-]{8,80}$/);
});

test("normalizeSessionId rejects invalid ids", () => {
  assert.throws(() => normalizeSessionId("bad"), /Invalid session_id/);
  assert.equal(normalizeSessionId(""), null);
});

test("resolveSessionId prefers explicit over release binding", () => {
  clearReleaseSessionsForTests();
  bindReleaseSession("rel_a", "as_boundboundboundbound");
  assert.equal(
    resolveSessionId({ sessionId: "as_explicitexplicitexplicit", releaseId: "rel_a" }),
    "as_explicitexplicitexplicit"
  );
});

test("resolveSessionId uses release binding when session_id omitted", () => {
  clearReleaseSessionsForTests();
  bindReleaseSession("rel_b", "as_boundboundboundbound");
  assert.equal(resolveSessionId({ releaseId: "rel_b" }), "as_boundboundboundbound");
});

test("ensureSessionId creates fresh id when requested", () => {
  clearReleaseSessionsForTests();
  const id = ensureSessionId({ createIfMissing: true });
  assert.match(id, /^as_/);
});

test("ensureSessionId does not create without flag", () => {
  clearReleaseSessionsForTests();
  assert.equal(ensureSessionId({}), null);
});
