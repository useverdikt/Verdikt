import React from "react";
import CollectingView from "../CollectingView.jsx";
import { normalizeReleaseStatus, UI_RELEASE_STATUS } from "../../../lib/releaseStatus.js";
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
  shippedWithoutCertificationCount = null,
  productionIncidentsCount = null,
  remediationDebtActive = false,
  navigate
}) {
  const setupChecklist = useWorkspaceSetupStatus(navigate, wsId, { thresholds, signalDefinitions });

  const isCollecting =
    current && normalizeReleaseStatus(current.status) === UI_RELEASE_STATUS.COLLECTING;
  // Full-page collecting UX only when this workspace has a single in-flight release.
  // With multiple releases, the dashboard expanded row provides the inline collecting panel (#31).
  if (isCollecting && releases.length <= 1) {
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
      shippedWithoutCertificationCount={shippedWithoutCertificationCount}
      productionIncidentsCount={productionIncidentsCount}
      remediationDebtActive={remediationDebtActive}
    />
  );
}
