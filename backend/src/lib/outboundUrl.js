"use strict";

const dns = require("dns").promises;
const net = require("net");
const { IS_PROD_LIKE } = require("../config");

function isPrivateOrLocalIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1") return true;
    if (l.startsWith("fe80:")) return true;
    if (l.startsWith("fc") || l.startsWith("fd")) return true;
    if (l.startsWith("::ffff:")) return isPrivateOrLocalIp(l.slice(7));
  }
  return false;
}

function isBlockedHostname(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "metadata.google.internal" || h.endsWith(".internal")) return true;
  return false;
}

/**
 * Validates outbound webhook URLs to reduce SSRF (private IPs, link-local, metadata).
 * @param {string} rawUrl
 * @returns {Promise<string>} Normalized URL string
 */
async function validateOutboundWebhookUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("url must be a valid URL");
  }

  if (IS_PROD_LIKE && parsed.protocol !== "https:") {
    throw new Error("Outbound webhook URL must use HTTPS in production");
  }
  if (!IS_PROD_LIKE && parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Outbound webhook URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Outbound webhook URL must not include embedded credentials");
  }

  const host = parsed.hostname;
  if (isBlockedHostname(host)) {
    throw new Error("Outbound webhook URL host is not allowed");
  }

  if (net.isIP(host)) {
    if (isPrivateOrLocalIp(host)) {
      throw new Error("Outbound webhook URL must not target private or link-local addresses");
    }
    return parsed.toString();
  }

  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("Outbound webhook URL host could not be resolved");
  }
  if (!records.length) {
    throw new Error("Outbound webhook URL host could not be resolved");
  }
  for (const { address } of records) {
    if (isPrivateOrLocalIp(address)) {
      throw new Error("Outbound webhook URL must not resolve to private or link-local addresses");
    }
  }
  return parsed.toString();
}

module.exports = {
  validateOutboundWebhookUrl,
  isPrivateOrLocalIp,
  isBlockedHostname
};
