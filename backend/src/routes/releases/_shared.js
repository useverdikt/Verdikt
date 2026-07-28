"use strict";

/**
 * Shared imports for release route submodules. Keep registration modules thin;
 * add new deps here when a submodule needs them.
 */
const { queryOne, queryAll, run, transaction } = require("../../database");
const { getUserRowForAuthById } = require("../../services/authUserLookup");

const {
  sendError,
  nowIso,
  writeAudit,
  auditActorFromAuth,
  authMiddleware,
  requireHumanSession,
  requireNonViewer,
  requireReleaseAccess,
  requireOverrideApproverRole,
  isAllowedSignalValue,
  evaluateReleaseAfterSignalIngest,
  mapIntegrationSignals,
  releaseVerdictLockedAgainstIngest,
  releaseIngestLockError,
  validateSignalPayload,
  getReleaseIntelligence,
  upsertReleaseIntelligence,
  assessOverrideJustification,
  buildIntelligenceTrace,
  verifyCertificationRecord,
  getCertSignaturePublic,
  signCertificationRecord,
  getEarlyWarning,
  getFailureModes,
  issueStreamToken,
  validateStreamToken,
  attachStream,
  signalIngestRateLimit,
  gatePollRateLimit,
  computeAndPersistRecommendation,
  getRecommendation,
  getRecommendationForRelease,
  ingestProductionSignals,
  getProductionObservations,
  computeOutcomeAlignment,
  setIncidentRef,
  openMonitoringWindow,
  scanWindow,
  getMonitoringWindow,
  pullConnectedSourcesForRelease,
  extendCollectionDeadline,
  AI_SIGNAL_DEFINITIONS
} = require("../deps");

const { buildReleaseGateResponse } = require("../../services/releaseGate");
const { buildReleaseBriefWithAudit } = require("../../services/releaseBrief");
const { createEscalationRequest, notifyEscalationCreated } = require("../../services/escalations");
const { applyReleaseOverride } = require("../../services/releaseOverride");
const { summarizePullResult } = require("../../services/integrationPullStatus");
const { buildReleaseSummary, buildReleaseDetail } = require("../../services/releaseDetail");
const { listReleaseAuditEvents } = require("../../services/releaseAudit");
const {
  extractIdempotencyKey,
  countSignalsForIdempotencyKey,
  respondToDuplicateSignalIngest
} = require("../../services/signalIngestIdempotency");
const { ingestIntegrationSignals, resolveIntegrationIdempotencyKey } = require("../../services/signalIngest");

module.exports = {
  queryOne,
  queryAll,
  run,
  transaction,
  getUserRowForAuthById,
  sendError,
  nowIso,
  writeAudit,
  auditActorFromAuth,
  authMiddleware,
  requireHumanSession,
  requireNonViewer,
  requireReleaseAccess,
  requireOverrideApproverRole,
  isAllowedSignalValue,
  evaluateReleaseAfterSignalIngest,
  mapIntegrationSignals,
  releaseVerdictLockedAgainstIngest,
  releaseIngestLockError,
  validateSignalPayload,
  getReleaseIntelligence,
  upsertReleaseIntelligence,
  assessOverrideJustification,
  buildIntelligenceTrace,
  verifyCertificationRecord,
  getCertSignaturePublic,
  signCertificationRecord,
  getEarlyWarning,
  getFailureModes,
  issueStreamToken,
  validateStreamToken,
  attachStream,
  signalIngestRateLimit,
  gatePollRateLimit,
  computeAndPersistRecommendation,
  getRecommendation,
  getRecommendationForRelease,
  ingestProductionSignals,
  getProductionObservations,
  computeOutcomeAlignment,
  setIncidentRef,
  openMonitoringWindow,
  scanWindow,
  getMonitoringWindow,
  pullConnectedSourcesForRelease,
  extendCollectionDeadline,
  AI_SIGNAL_DEFINITIONS,
  buildReleaseGateResponse,
  buildReleaseBriefWithAudit,
  createEscalationRequest,
  notifyEscalationCreated,
  applyReleaseOverride,
  summarizePullResult,
  buildReleaseSummary,
  buildReleaseDetail,
  listReleaseAuditEvents,
  extractIdempotencyKey,
  countSignalsForIdempotencyKey,
  respondToDuplicateSignalIngest,
  ingestIntegrationSignals,
  resolveIntegrationIdempotencyKey
};
