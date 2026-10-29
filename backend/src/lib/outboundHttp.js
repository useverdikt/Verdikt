"use strict";

const http = require("http");
const https = require("https");
const {
  DEFAULT_TIMEOUT_MS,
  fetchWithTimeout
} = require("./fetchWithTimeout");
const { publicAddressesForUrl } = require("./outboundUrl");

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
    pinPublicDns = false,
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

  if (pinPublicDns) {
    return postJsonPinned(url, options.body, options.headers, timeoutMs);
  }

  return fetchWithTimeout(url, options, timeoutMs);
}

function postJsonPinned(url, body, headers, timeoutMs) {
  return publicAddressesForUrl(url).then((addresses) => new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const hostname = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
    const req = lib.request({
      protocol: parsed.protocol,
      hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: "POST",
      headers,
      servername: hostname,
      lookup(_hostname, options, callback) {
        const pinned = addresses.map((item) => ({ address: item.address, family: item.family }));
        if (!pinned.length) {
          callback(new Error("Outbound webhook URL host could not be resolved"));
          return;
        }
        if (options.all) callback(null, pinned);
        else callback(null, pinned[0].address, pinned[0].family);
      },
      timeout: timeoutMs
    }, (res) => {
      res.resume();
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`fetch timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  }));
}

module.exports = {
  postJsonWithTimeout
};
