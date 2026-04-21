"use strict";

/**
 * Shared requires for workspace + release route modules (single import surface).
 */

const config = require("../config");
const { nowIso, toIsoPlusMinutes } = require("../lib/time");
const { writeAudit } = require("../services/audit");
const { listReleaseDeltas } = require("../services/delta");
const {
  authMiddleware,
  requireWorkspaceMatch,
  requireReleaseAccess,
  requireNonViewer,
  requireOverrideApproverRole,
  signToken,
  publicUser
} = require("../middleware/auth");
const {
  checkLoginRateLimit,
  checkForgotPasswordRateLimit,
  checkRegisterRateLimit,
  checkWaitlistRateLimit,
  webhookRateLimit
} = require("../middleware/rateLimit");
const { sendPasswordResetEmail, sendWaitlistLeadEmail } = require("../services/email");
const { verifyInboundWebhookSignature } = require("../services/inboundWebhookSecrets");
const {
  ensureWorkspaceSeeded,
  getThresholdMap,
  getWorkspacePolicy,
  isAllowedSignalValue,
  evaluateReleaseAfterSignalIngest,
  mapIntegrationSignals,
  releaseVerdictLockedAgainstIngest,
  buildThresholdSuggestions,
  maybeEnrichSuggestionReason,
  getReleaseIntelligence,
  upsertReleaseIntelligence,
  assessOverrideJustification,
  buildIntelligenceTrace,
  resolveReleaseForWorkspaceIngest
} = require("../services/domain");
const { verifyCertificationRecord, getCertSignaturePublic, signCertificationRecord } = require("../services/certSigner");
const { verifyAuditIntegrity } = require("../services/auditIntegrity");
const { getBaselinePolicy, setBaselinePolicy } = require("../services/baselineEngine");
const { getEarlyWarning } = require("../services/earlyWarning");
const { getOutboundWebhook, setOutboundWebhook, deleteOutboundWebhook } = require("../services/outboundWebhook");
const { validateSignalPayload, getSignalSchema } = require("../services/signalValidator");
const { computeAndPersistCorrelations, getCorrelations, getFailureModes, getFailureModeTrends } = require("../services/correlationEngine");
const { computeAndPersistRecommendation, getRecommendation } = require("../services/recommendationEngine");
const { upsertEnvChain, listEnvChains, deleteEnvChain, registerChainLink, getChainStatus, getChainsForRelease } = require("../services/envChain");
const { issueStreamToken, validateStreamToken, attachStream } = require("../services/sseManager");
const { getVcsIntegration, setVcsIntegration, deleteVcsIntegration } = require("../services/vcsWriteback");
const { computeOverrideAnalytics } = require("../services/overrideAnalytics");
const { computeSignalReliability, getSignalReliability, getReliabilitySummary } = require("../services/signalReliability");
const { ingestProductionSignals, getWorkspaceProductionHealth, getProductionObservations, computeOutcomeAlignment, setIncidentRef, OUTCOME_CRITERIA } = require("../services/productionFeedback");
const { simulateThresholds } = require("../services/thresholdSimulator");
const { openMonitoringWindow, scanWindow, getMonitoringWindow, getWorkspaceMonitoringSummary } = require("../services/vcsMonitor");
const multer = require("multer");
const {
  upsertIntegration,
  listIntegrations,
  deleteIntegration,
  importCsv,
  getLatestCsvImport,
  deleteCsvImports
} = require("../services/signalIntegrations");

const signalCsvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const { applyCsvImportToWorkspace, pullConnectedSourcesForRelease } = require("../services/signalIngestFromSources");

const {
  AI_SIGNAL_DEFINITIONS,
  ALLOWED_RELEASE_TYPES,
  DEFAULT_COLLECTION_WINDOW_MINUTES,
  BCRYPT_ROUNDS,
  ENABLE_THRESHOLD_SUGGESTIONS,
  IS_PROD_LIKE,
  ALLOW_PUBLIC_REGISTRATION
} = config;

module.exports = {
  nowIso,
  toIsoPlusMinutes,
  writeAudit,
  listReleaseDeltas,
  authMiddleware,
  requireWorkspaceMatch,
  requireReleaseAccess,
  requireNonViewer,
  requireOverrideApproverRole,
  signToken,
  publicUser,
  checkLoginRateLimit,
  checkForgotPasswordRateLimit,
  checkRegisterRateLimit,
  checkWaitlistRateLimit,
  webhookRateLimit,
  sendPasswordResetEmail,
  sendWaitlistLeadEmail,
  verifyInboundWebhookSignature,
  ensureWorkspaceSeeded,
  getThresholdMap,
  getWorkspacePolicy,
  isAllowedSignalValue,
  evaluateReleaseAfterSignalIngest,
  mapIntegrationSignals,
  releaseVerdictLockedAgainstIngest,
  buildThresholdSuggestions,
  maybeEnrichSuggestionReason,
  getReleaseIntelligence,
  upsertReleaseIntelligence,
  assessOverrideJustification,
  buildIntelligenceTrace,
  resolveReleaseForWorkspaceIngest,
  verifyCertificationRecord,
  getCertSignaturePublic,
  signCertificationRecord,
  verifyAuditIntegrity,
  getBaselinePolicy,
  setBaselinePolicy,
  getEarlyWarning,
  getOutboundWebhook,
  setOutboundWebhook,
  deleteOutboundWebhook,
  validateSignalPayload,
  getSignalSchema,
  computeAndPersistCorrelations,
  getCorrelations,
  getFailureModes,
  getFailureModeTrends,
  computeAndPersistRecommendation,
  getRecommendation,
  upsertEnvChain,
  listEnvChains,
  deleteEnvChain,
  registerChainLink,
  getChainStatus,
  getChainsForRelease,
  issueStreamToken,
  validateStreamToken,
  attachStream,
  getVcsIntegration,
  setVcsIntegration,
  deleteVcsIntegration,
  computeOverrideAnalytics,
  computeSignalReliability,
  getSignalReliability,
  getReliabilitySummary,
  ingestProductionSignals,
  getWorkspaceProductionHealth,
  getProductionObservations,
  computeOutcomeAlignment,
  setIncidentRef,
  OUTCOME_CRITERIA,
  simulateThresholds,
  openMonitoringWindow,
  scanWindow,
  getMonitoringWindow,
  getWorkspaceMonitoringSummary,
  upsertIntegration,
  listIntegrations,
  deleteIntegration,
  importCsv,
  getLatestCsvImport,
  deleteCsvImports,
  signalCsvUpload,
  applyCsvImportToWorkspace,
  pullConnectedSourcesForRelease,
  AI_SIGNAL_DEFINITIONS,
  ALLOWED_RELEASE_TYPES,
  DEFAULT_COLLECTION_WINDOW_MINUTES,
  BCRYPT_ROUNDS,
  ENABLE_THRESHOLD_SUGGESTIONS,
  IS_PROD_LIKE,
  ALLOW_PUBLIC_REGISTRATION
};
