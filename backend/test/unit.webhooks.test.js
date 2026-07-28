"use strict";

/**
 * Split from former backend.test.js — domain suite.
 */

require("./helpers/backendFixtures");

const crypto = require("crypto");
const { describe, it, after, before } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { queryOne, run } = require("../src/database");
const {
  GEMINI_STUB,
  createApp,
  writeAudit,
  ensureWorkspaceSeeded,
  seedDefaultThresholdsForTest,
  setUserRole,
  signGithubPayload,
  waitForAuditEvent,
  waitForAuditEventCount
} = require("./helpers/backendFixtures");
const {
  computeVerdict,
  getThresholdMap,
  assessOverrideJustification,
  evaluateReleaseAfterSignalIngest
} = require("../src/services/domain");
const { getMissingRequiredSignals } = require("../src/services/verdictEngine");
const { analyzeReleaseDeltas } = require("../src/services/delta");
const sharedPkg = require("../src/lib/sharedPkg");
const { nowIso } = require("../src/lib/time");
const { maybeEnrichVerdictIntelligence } = require("../src/services/llmAssist");
const { callIntelligenceModel } = require("../src/services/aiClient");
const { upsertReleaseIntelligence, getReleaseIntelligence } = require("../src/services/intelligenceBuilder");
const { computeAndPersistRecommendation, getRecommendation } = require("../src/services/recommendationEngine");

describe("buildInboundSecretCandidates (unit)", () => {
  it("uses only workspace secret when present (no global fallback)", () => {
    const { buildInboundSecretCandidates } = require("../src/services/inboundWebhookSecrets");
    const onlyWs = buildInboundSecretCandidates("workspace-secret-abc", { allowGlobalFallbacks: true });
    assert.deepEqual(onlyWs, ["workspace-secret-abc"]);
  });

  it("falls back to global WEBHOOK_SECRET in dev when workspace secret missing", () => {
    const { buildInboundSecretCandidates } = require("../src/services/inboundWebhookSecrets");
    const globalOnly = buildInboundSecretCandidates(null, { allowGlobalFallbacks: true });
    assert.deepEqual(globalOnly, [process.env.WEBHOOK_SECRET]);
  });
});

describe("validateOutboundWebhookUrl (unit)", () => {
  it("blocks localhost and metadata-style hosts", async () => {
    const { validateOutboundWebhookUrl } = require("../src/lib/outboundUrl");
    await assert.rejects(() => validateOutboundWebhookUrl("http://127.0.0.1/hook"), /private|not allowed/i);
    await assert.rejects(() => validateOutboundWebhookUrl("http://localhost/hook"), /not allowed/i);
  });
});

describe("webhook delivery unit", () => {
  it("buildVerdictPayload includes certification and cert_signature fields", () => {
    const { buildVerdictPayload } = require("../src/services/outboundWebhook");
    const release = {
      id: "r_webhook_unit",
      workspace_id: "ws_webhook",
      version: "v2.0.0",
      release_type: "model_update",
      environment: "prod",
      status: "CERTIFIED",
      verdict_issued_at: nowIso()
    };
    const sigRow = { payload_hash: "abc123", signature: "sig456", signed_at: nowIso(), algorithm: "HMAC-SHA256-v1" };
    const cert = { summary: "All passed.", risk_level: "low", confidence: 0.95 };
    const payload = buildVerdictPayload(release, "CERTIFIED", null, sigRow, [], cert);
    assert.equal(payload.event, "CERTIFIED");
    assert.ok(payload.cert_signature?.payload_hash, "cert_signature should be present");
    assert.equal(payload.cert_signature.signature, "sig456");
    assert.ok(payload.certification?.summary, "certification context should be present");
    assert.equal(payload.certification.confidence, 0.95);
  });

  it("buildVerdictPayload handles missing sigRow and certification gracefully", () => {
    const { buildVerdictPayload } = require("../src/services/outboundWebhook");
    const release = {
      id: "r_webhook_unit2",
      workspace_id: "ws_webhook",
      version: "v2.0.1",
      release_type: "model_update",
      status: "UNCERTIFIED",
      verdict_issued_at: nowIso()
    };
    const payload = buildVerdictPayload(release, "UNCERTIFIED", null, null, [], null);
    assert.strictEqual(payload.cert_signature, null, "cert_signature should be null when no sigRow");
    assert.strictEqual(payload.certification, null, "certification should be null for UNCERTIFIED");
  });
});

