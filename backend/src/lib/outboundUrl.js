"use strict";

const dns = require("dns").promises;
const net = require("net");
const { IS_PROD_LIKE } = require("../config");

const blockedIps = new net.BlockList();
blockedIps.addSubnet("0.0.0.0", 8, "ipv4");
blockedIps.addSubnet("10.0.0.0", 8, "ipv4");
blockedIps.addSubnet("100.64.0.0", 10, "ipv4");
blockedIps.addSubnet("127.0.0.0", 8, "ipv4");
blockedIps.addSubnet("169.254.0.0", 16, "ipv4");
blockedIps.addSubnet("172.16.0.0", 12, "ipv4");
blockedIps.addSubnet("192.0.0.0", 24, "ipv4");
blockedIps.addSubnet("192.0.2.0", 24, "ipv4");
blockedIps.addSubnet("192.168.0.0", 16, "ipv4");
blockedIps.addSubnet("198.18.0.0", 15, "ipv4");
blockedIps.addSubnet("198.51.100.0", 24, "ipv4");
blockedIps.addSubnet("203.0.113.0", 24, "ipv4");
blockedIps.addSubnet("224.0.0.0", 4, "ipv4");
blockedIps.addAddress("255.255.255.255", "ipv4");
blockedIps.addAddress("::", "ipv6");
blockedIps.addAddress("::1", "ipv6");
blockedIps.addSubnet("fc00::", 7, "ipv6");
blockedIps.addSubnet("fe80::", 10, "ipv6");
blockedIps.addSubnet("ff00::", 8, "ipv6");

function stripIpDecorations(ip) {
  let value = String(ip || "").trim().toLowerCase().replace(/\.$/, "");
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  return value;
}

function expandIPv6(ip) {
  let value = stripIpDecorations(ip);
  const dotted = value.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const parts = dotted[2].split(".").map(Number);
    if (parts.some((n) => n > 255)) return null;
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    value = `${dotted[1]}${hi}:${lo}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
  }
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (missing < 0) return null;
  const groups = halves.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head;
  if (groups.length !== 8) return null;
  const parsed = groups.map((group) => Number.parseInt(group || "0", 16));
  if (parsed.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  return parsed;
}

function ipv4FromWords(hi, lo) {
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join(".");
}

function embeddedPrivateIPv4(groups) {
  if (!groups) return false;
  const zeros = (count) => groups.slice(0, count).every((n) => n === 0);
  if (zeros(5) && groups[5] === 0xffff) {
    return isPrivateOrLocalIp(ipv4FromWords(groups[6], groups[7]));
  }
  if (zeros(6)) {
    return isPrivateOrLocalIp(ipv4FromWords(groups[6], groups[7]));
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
    return isPrivateOrLocalIp(ipv4FromWords(groups[6], groups[7]));
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return true;
  if (groups[0] === 0x2002) return isPrivateOrLocalIp(ipv4FromWords(groups[1], groups[2]));
  return false;
}

function isPrivateOrLocalIp(ip) {
  const value = stripIpDecorations(ip);
  if (net.isIPv4(value)) return blockedIps.check(value, "ipv4");
  if (!net.isIPv6(value) && !value.includes(":")) return false;
  const groups = expandIPv6(value);
  if (!groups) return true;
  if (embeddedPrivateIPv4(groups)) return true;
  const packed = groups.map((n) => n.toString(16)).join(":");
  return blockedIps.check(packed, "ipv6");
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
async function resolvePublicOutboundUrl(rawUrl) {
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

  const host = stripIpDecorations(parsed.hostname);
  if (isBlockedHostname(host)) {
    throw new Error("Outbound webhook URL host is not allowed");
  }

  if (net.isIP(host)) {
    if (isPrivateOrLocalIp(host)) {
      throw new Error("Outbound webhook URL must not target private or link-local addresses");
    }
    return {
      href: parsed.toString(),
      addresses: [{ address: host, family: net.isIP(host) }]
    };
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
  return {
    href: parsed.toString(),
    addresses: records.map((record) => ({ address: record.address, family: record.family }))
  };
}

async function validateOutboundWebhookUrl(rawUrl) {
  const { href } = await resolvePublicOutboundUrl(rawUrl);
  return href;
}

async function validateSlackWebhookUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("Slack webhook URL must be a valid URL");
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const allowedHosts = new Set(["hooks.slack.com", "hooks.slack-gov.com"]);
  if (parsed.protocol !== "https:" || !allowedHosts.has(host)) {
    throw new Error("Slack webhook URL must use an approved Slack HTTPS host");
  }
  if (!/^\/services\/[^/]+\/[^/]+\/[^/]+\/?$/.test(parsed.pathname)) {
    throw new Error("Slack webhook URL must use the Slack /services/ webhook path");
  }

  return validateOutboundWebhookUrl(parsed.toString());
}

/**
 * Addresses a public URL may connect to. Callers pin DNS lookups to this list
 * so a name cannot rebind to a private address between the check and the socket.
 */
async function publicAddressesForUrl(rawUrl) {
  const { addresses } = await resolvePublicOutboundUrl(rawUrl);
  return addresses;
}

module.exports = {
  validateOutboundWebhookUrl,
  validateSlackWebhookUrl,
  publicAddressesForUrl,
  isPrivateOrLocalIp,
  isBlockedHostname
};
