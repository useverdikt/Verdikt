"use strict";

const BACKEND_RELEASE_STATUSES = ["COLLECTING", "CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE"];

const CERT_LIKE = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);

function isCertLikeStatus(status) {
  return CERT_LIKE.has(String(status || "").toUpperCase());
}

function isProdEnvironment(env) {
  const s = String(env || "").toLowerCase();
  return s === "prod" || s === "production" || s === "main" || s === "master";
}

module.exports = {
  BACKEND_RELEASE_STATUSES,
  CERT_LIKE,
  isCertLikeStatus,
  isProdEnvironment
};
