"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.NODE_ENV = "test";

const { initDatabase } = require("../src/database");
const { buildSignalSourcesPanel } = require("../src/services/signalSourcesPanel");
const { createIntegrationRequest, listIntegrationRequests } = require("../src/services/integrationRequests");
const { ensureWorkspaceSeeded } = require("../src/services/domain");

before(async () => {
  await initDatabase();
});

describe("signalSourcesPanel", () => {
  it("buildSignalSourcesPanel lists pull connectors including langsmith", async () => {
    const ws = `ws_panel_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(ws);
    const panel = await buildSignalSourcesPanel(ws);
    assert.ok(Array.isArray(panel.pull_connectors));
    const ids = panel.pull_connectors.map((c) => c.source_id);
    assert.ok(ids.includes("langsmith"));
    assert.ok(ids.includes("braintrust"));
    assert.equal(panel.pull_connectors.every((c) => c.ingest_mode === "pull"), true);
    assert.ok(panel.api_push?.ingest_path);
  });

  it("integration request round-trip", async () => {
    const ws = `ws_intreq_${crypto.randomBytes(4).toString("hex")}`;
    await ensureWorkspaceSeeded(ws);
    const created = await createIntegrationRequest(ws, { source_name: "Honeycomb", notes: "Need latency" }, "test@local");
    assert.equal(created.status, "pending");
    assert.equal(created.source_name, "Honeycomb");
    const list = await listIntegrationRequests(ws);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
  });
});
