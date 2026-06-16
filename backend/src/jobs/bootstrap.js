"use strict";

const {
  runCollectionDeadlineSweep,
  startCollectionDeadlineSweepJob
} = require("./collectionSweep");
const { runVcsMonitorSweep, startVcsMonitorSweepJob } = require("./vcsMonitorSweep");
const {
  runEscalationSlaSweepJobOnce,
  startEscalationSlaSweepJob
} = require("./escalationSlaSweep");

/**
 * Start background interval jobs (collection sweep, VCS monitor, escalation SLA).
 * API server runs these by default; set RUN_BACKGROUND_JOBS=0 to disable when using worker.js.
 */
function startBackgroundJobs() {
  const handles = {
    sweepInterval: null,
    vcsMonitorInterval: null,
    escalationSlaInterval: null,
    vcsInitialTimeout: null
  };

  void runCollectionDeadlineSweep();
  handles.sweepInterval = startCollectionDeadlineSweepJob();
  handles.vcsMonitorInterval = startVcsMonitorSweepJob();
  handles.escalationSlaInterval = startEscalationSlaSweepJob();
  void runEscalationSlaSweepJobOnce();
  handles.vcsInitialTimeout = setTimeout(() => void runVcsMonitorSweep().catch(() => {}), 8_000);

  return handles;
}

function stopBackgroundJobs(handles) {
  if (!handles) return;
  if (handles.sweepInterval) clearInterval(handles.sweepInterval);
  if (handles.vcsMonitorInterval) clearInterval(handles.vcsMonitorInterval);
  if (handles.escalationSlaInterval) clearInterval(handles.escalationSlaInterval);
  if (handles.vcsInitialTimeout) clearTimeout(handles.vcsInitialTimeout);
}

module.exports = { startBackgroundJobs, stopBackgroundJobs, runCollectionDeadlineSweep };
