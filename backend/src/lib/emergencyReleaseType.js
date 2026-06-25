"use strict";

const sharedPkg = require("./sharedPkg");

/**
 * Resolve emergency release typing without assuming sharedPkg finished initializing
 * (postinstall sync-shared overwrites backend/shared from repo shared/).
 */
function isEmergencyReleaseType(releaseType) {
  if (typeof sharedPkg.isEmergencyReleaseType === "function") {
    return sharedPkg.isEmergencyReleaseType(releaseType);
  }
  if (typeof sharedPkg.getEmergencyReleaseTypesSet === "function") {
    return sharedPkg.getEmergencyReleaseTypesSet().has(String(releaseType || ""));
  }
  const fromRaw = sharedPkg.emergencyReleaseTypes || sharedPkg.raw?.emergencyReleaseTypes;
  if (Array.isArray(fromRaw)) {
    return new Set(fromRaw).has(String(releaseType || ""));
  }
  return false;
}

module.exports = { isEmergencyReleaseType };
