"use strict";

/**
 * AES-256-GCM field encryption for secrets at rest.
 * Wire format: iv_hex:auth_tag_hex:ciphertext_hex (hex-encoded bytes).
 * When ENCRYPTION_MASTER_KEY is unset (local dev), values are stored plaintext.
 */

const crypto = require("crypto");
const { IS_PROD_LIKE } = require("../config");

const PREFIX = "v1";

function getKeyBuffer() {
  const raw = (process.env.ENCRYPTION_MASTER_KEY || "").trim();
  if (!raw) return null;
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ENCRYPTION_MASTER_KEY must be a 64-character hex string (32 bytes).");
  }
  return Buffer.from(hex, "hex");
}

function isEncryptionEnabled() {
  return getKeyBuffer() != null;
}

/**
 * @param {string} plaintext
 * @returns {string} Encrypted blob or plaintext if encryption disabled
 */
function encryptToken(plaintext) {
  const t = String(plaintext ?? "");
  const key = getKeyBuffer();
  if (!key) return t;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(t, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/**
 * @param {string} stored
 * @returns {string}
 */
function decryptToken(stored) {
  const s = String(stored ?? "");
  const key = getKeyBuffer();
  if (!key || !looksEncrypted(s)) return s;
  const without = s.startsWith(`${PREFIX}:`) ? s.slice(PREFIX.length + 1) : s;
  const parts = without.split(":");
  if (parts.length !== 3) return s;
  const [ivH, tagH, ctH] = parts;
  const iv = Buffer.from(ivH, "hex");
  const tag = Buffer.from(tagH, "hex");
  const data = Buffer.from(ctH, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function looksEncrypted(stored) {
  const s = String(stored ?? "");
  return s.startsWith(`${PREFIX}:`) && s.split(":").length === 4;
}

/**
 * Encrypt plaintext field before persist; if encryption is on and value was plaintext,
 * caller may replace on read via migratePlaintextField.
 */
function migratePlaintextFieldIfNeeded(stored, columnName) {
  if (!getKeyBuffer() || !stored || looksEncrypted(stored)) return stored;
  if (IS_PROD_LIKE) {
    console.warn(`[encryption] Migrating plaintext ${columnName} to ciphertext at rest (one-time).`);
  }
  return encryptToken(stored);
}

module.exports = {
  encryptToken,
  decryptToken,
  looksEncrypted,
  isEncryptionEnabled,
  migratePlaintextFieldIfNeeded
};
