"use strict";

const CERT_LIKE = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);

function isProdEnvironment(env) {
  return String(env || "").toLowerCase() === "prod";
}

function isCertLikeStatus(status) {
  return CERT_LIKE.has(String(status || "").toUpperCase());
}

module.exports = {
  CERT_LIKE,
  isProdEnvironment,
  isCertLikeStatus
};
