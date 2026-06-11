"use strict";

const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

/** Run downstream handlers with audit context (agent session, auth snapshot). */
function runWithAuditContext(ctx, fn) {
  return storage.run(ctx || {}, fn);
}

function getAuditContext() {
  return storage.getStore() || {};
}

function getAgentSessionIdFromContext() {
  return getAuditContext().agentSessionId || null;
}

module.exports = {
  runWithAuditContext,
  getAuditContext,
  getAgentSessionIdFromContext
};
