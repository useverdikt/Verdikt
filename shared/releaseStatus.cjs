"use strict";

/**
 * CJS facade for sync require(). Implementation is the ESM module loaded via
 * a frozen mirror below so Node < require(esm) consumers keep working.
 * Keep in sync with releaseStatus.mjs (asserted in p4Consistency.test.js).
 */

const BACKEND_RELEASE_STATUSES = ["COLLECTING", "CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE"];

const CERT_LIKE = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);

/** Releases with a final verdict (excludes COLLECTING). */
const VERDICTED = new Set(["CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);

const BLOCKED_OR_COLLECTING = new Set(["UNCERTIFIED", "COLLECTING"]);

function isCertLikeStatus(status) {
  return CERT_LIKE.has(String(status || "").toUpperCase());
}

function isVerdictedStatus(status) {
  return VERDICTED.has(String(status || "").toUpperCase());
}

function isBlockedOrCollectingStatus(status) {
  return BLOCKED_OR_COLLECTING.has(String(status || "").toUpperCase());
}

function isProdEnvironment(env) {
  const s = String(env || "").toLowerCase();
  return s === "prod" || s === "production" || s === "main" || s === "master";
}

module.exports = {
  BACKEND_RELEASE_STATUSES,
  CERT_LIKE,
  VERDICTED,
  BLOCKED_OR_COLLECTING,
  isCertLikeStatus,
  isVerdictedStatus,
  isBlockedOrCollectingStatus,
  isProdEnvironment
};
