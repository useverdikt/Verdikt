import React from "react";
import CollectingView from "../CollectingView.jsx";
import { ReleaseDashboardRedesign } from "../../release/ReleaseDashboardRedesign.jsx";
import { getSafeApiBase } from "../../../lib/apiBase.js";

export default function ReleaseView({
  current,
  releases = [],
  wsReady = true,
  wsId,
  prodObservationEnabled = false,
  formatReleaseAge,
  thresholds,
  releaseTypes,
  signalCategories,
  calcCategoryStatus,
  setDetailCat: _setDetailCat,
  setShowStartCert,
  onViewFullRecord,
  onBeginOverride,
  handleSimulateSignal,
  handleRunVerdict,
  signalSources,
  releaseVersionPrimarySecondary,
  onCollectingAction,
  onEnsureReleaseDetail,
  onHydrateVisibleSummaries,
  hasMoreReleases = false,
  loadingMoreReleases = false,
  onLoadMoreReleases
}) {
  const setupChecklist = (() => {
    const thresholdsConfigured = ["accuracy", "safety", "tone", "hallucination", "relevance"].every(
      (k) => thresholds[k] !== undefined && thresholds[k] !== null && thresholds[k] !== ""
    );
    const apiBaseConfigured =
      getSafeApiBase() === "" ||
      (import.meta.env.DEV && (localStorage.getItem("vdk3_api_base") || "").trim().length > 0) ||
      (import.meta.env.PROD && Boolean(String(import.meta.env.VITE_API_BASE || "").trim()));
    const items = [
      { id: "api", label: "Connect signal sources", done: apiBaseConfigured, to: "/settings?section=api" },
      { id: "thresholds", label: "Configure quality thresholds", done: thresholdsConfigured, to: "/thresholds" },
      { id: "trigger", label: "Configure automation trigger (optional)", done: true, to: "/settings?section=trigger" },
    ];
    return { items, complete: items.every((i) => i.done) };
  })();

  // Collecting view for selected release (shown as a full overlay if the current release is collecting)
  if (current && current.status === "collecting" && releases.length <= 1) {
    return (
      <CollectingView
        release={current}
        onSimulate={handleSimulateSignal}
        onRunVerdict={handleRunVerdict}
        signalSources={signalSources}
        releaseTypes={releaseTypes}
      />
    );
  }

  return (
    <ReleaseDashboardRedesign
      releases={releases}
      wsReady={wsReady}
      wsId={wsId}
      prodObservationEnabled={prodObservationEnabled}
      signalCategories={signalCategories}
      calcCategoryStatus={calcCategoryStatus}
      thresholds={thresholds}
      releaseTypes={releaseTypes}
      releaseVersionPrimarySecondary={releaseVersionPrimarySecondary}
      formatReleaseAge={formatReleaseAge}
      onNewRelease={() => setShowStartCert?.(true)}
      onViewFullRecord={onViewFullRecord}
      onBeginOverride={onBeginOverride}
      onCollectingAction={onCollectingAction}
      onEnsureReleaseDetail={onEnsureReleaseDetail}
      onHydrateVisibleSummaries={onHydrateVisibleSummaries}
      setupChecklist={setupChecklist}
      hasMoreReleases={hasMoreReleases}
      loadingMoreReleases={loadingMoreReleases}
      onLoadMoreReleases={onLoadMoreReleases}
    />
  );
}
