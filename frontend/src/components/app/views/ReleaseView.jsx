import React from "react";
import CollectingView from "../CollectingView.jsx";
import { ReleaseDashboardRedesign } from "../../release/ReleaseDashboardRedesign.jsx";
import { useWorkspaceSetupStatus } from "../../../hooks/useWorkspaceSetupStatus.js";

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
  signalDefinitions = [],
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
  onLoadMoreReleases,
  navigate
}) {
  const setupChecklist = useWorkspaceSetupStatus(navigate, wsId, { thresholds, signalDefinitions });

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
      signalDefinitions={signalDefinitions}
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
