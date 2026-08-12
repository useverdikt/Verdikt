"use strict";

const {
  DEFAULT_TIMEOUT_MS,
  fetchWithTimeout
} = require("./fetchWithTimeout");

/**
 * Sends one JSON POST attempt with bounded network time.
 *
 * This helper intentionally does not retry. Outbound side effects must not be
 * repeated unless the caller has a receiver-supported idempotency contract.
 */
async function postJsonWithTimeout(
  url,
  body,
  {
    headers = {},
    redirect,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}
) {
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
  if (redirect) options.redirect = redirect;

  return fetchWithTimeout(url, options, timeoutMs);
}

module.exports = {
  postJsonWithTimeout
};
