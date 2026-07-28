"use strict";

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const sseManager = require("../src/services/sseManager");
const ssePubSub = require("../src/services/ssePubSub");
const { closeListener } = require("../src/services/ssePubSub");

function createFakeRes() {
  const messages = [];
  const handlers = {};
  const res = {
    messages,
    ended: false,
    write: (chunk) => messages.push(String(chunk)),
    end: () => { res.ended = true; },
    setHeader: () => {},
    flushHeaders: () => {},
    on: (event, handler) => {
      handlers[event] = handler;
    },
    emit: (event) => {
      if (handlers[event]) handlers[event]();
    }
  };
  return res;
}

describe("SSE cross-replica pub/sub", () => {
  const originals = {
    isEnabled: ssePubSub.isEnabled,
    publish: ssePubSub.publish,
    subscribe: ssePubSub.subscribe,
    unsubscribe: ssePubSub.unsubscribe
  };
  const attachedRes = [];

  afterEach(() => {
    for (const res of attachedRes) {
      try { res.emit("close"); } catch {}
    }
    attachedRes.length = 0;
    ssePubSub.isEnabled = originals.isEnabled;
    ssePubSub.publish = originals.publish;
    ssePubSub.subscribe = originals.subscribe;
    ssePubSub.unsubscribe = originals.unsubscribe;
  });

  test("publishes to Redis backplane when enabled", () => {
    const published = [];
    ssePubSub.isEnabled = () => true;
    ssePubSub.publish = async (releaseId, event, data) => {
      published.push({ releaseId, event, data });
    };
    ssePubSub.subscribe = async () => {};
    ssePubSub.unsubscribe = async () => {};

    sseManager.broadcastToRelease("rel_1", "signal_progress", { value: 42 });

    assert.equal(published.length, 1);
    assert.equal(published[0].releaseId, "rel_1");
    assert.equal(published[0].event, "signal_progress");
    assert.deepEqual(published[0].data, { value: 42 });
  });

  test("forwards remote Redis messages to local subscribers", async () => {
    let remoteHandler = null;
    ssePubSub.isEnabled = () => true;
    ssePubSub.subscribe = async (releaseId, handler) => {
      remoteHandler = handler;
    };
    ssePubSub.unsubscribe = async () => {};
    ssePubSub.publish = async () => {};

    const res = createFakeRes();
    attachedRes.push(res);
    await sseManager.attachStream("rel_1", res);
    assert.ok(remoteHandler, "should subscribe to the Redis channel");

    remoteHandler("signal_progress", { value: 42 });
    assert.ok(res.messages.some((m) => m.includes("event: signal_progress")));
  });

  test("delivers events locally when Redis is not enabled", async () => {
    ssePubSub.isEnabled = () => false;
    ssePubSub.publish = async () => { throw new Error("should not be called"); };

    const res = createFakeRes();
    attachedRes.push(res);
    await sseManager.attachStream("rel_2", res);
    sseManager.broadcastToRelease("rel_2", "signal_progress", { value: 1 });

    assert.ok(res.messages.some((m) => m.includes("event: signal_progress")));
  });

  test("closes local streams when a remote verdict_and_close arrives", async () => {
    let remoteHandler = null;
    ssePubSub.isEnabled = () => true;
    ssePubSub.subscribe = async (releaseId, handler) => {
      remoteHandler = handler;
    };
    ssePubSub.unsubscribe = async () => {};
    ssePubSub.publish = async () => {};

    const res = createFakeRes();
    attachedRes.push(res);
    await sseManager.attachStream("rel_3", res);
    remoteHandler("verdict_and_close", { status: "CERTIFIED" });

    assert.ok(res.messages.some((m) => m.includes("event: verdict")));
    assert.ok(res.messages.some((m) => m.includes("event: stream_end")));
    assert.equal(res.ended, true);
  });

  test("real Postgres LISTEN/NOTIFY forwards messages across replicas", async () => {
    // Use the actual backplane functions (not mocks) against the test database.
    ssePubSub.isEnabled = originals.isEnabled;
    ssePubSub.publish = originals.publish;
    ssePubSub.subscribe = originals.subscribe;
    ssePubSub.unsubscribe = originals.unsubscribe;

    const received = [];
    const releaseId = `rel_real_${Date.now()}`;
    await ssePubSub.subscribe(releaseId, (event, data) => {
      received.push({ event, data });
    });
    await ssePubSub.publish(releaseId, "signal_progress", { value: 99 });
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(received.length, 1);
    assert.equal(received[0].event, "signal_progress");
    assert.deepEqual(received[0].data, { value: 99 });
    await ssePubSub.unsubscribe(releaseId);
    await closeListener();
  });
});
