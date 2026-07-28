/**
 * ESM facade for shared config helpers (Node).
 * Implementation lives in config.cjs for sync require() from the backend.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cjs = require("./config.cjs");

export const raw = cjs.raw;
export const normaliseSignalKey = cjs.normaliseSignalKey;
export const getAllowedReleaseTypes = cjs.getAllowedReleaseTypes;
export const getAllowedReleaseTypesSet = cjs.getAllowedReleaseTypesSet;
export const getEmergencyReleaseTypesSet = cjs.getEmergencyReleaseTypesSet;
export const isEmergencyReleaseType = cjs.isEmergencyReleaseType;
export const getDefaultThresholds = cjs.getDefaultThresholds;
export const getDefaultThresholdSeedRows = cjs.getDefaultThresholdSeedRows;
export const getAiSignalIds = cjs.getAiSignalIds;
export const getSignalThresholdDirection = cjs.getSignalThresholdDirection;
export const valueToThresholdBounds = cjs.valueToThresholdBounds;
export const normalizeThresholdBounds = cjs.normalizeThresholdBounds;
export const getSignalsForSource = cjs.getSignalsForSource;
export const getRegressionRequiredForReleaseType = cjs.getRegressionRequiredForReleaseType;

export default cjs;
