import React from "react";
import { ReleaseDashboardRedesign } from "../../release/ReleaseDashboardRedesign.jsx";
import { useWorkspaceSetupStatus } from "../../../hooks/useWorkspaceSetupStatus.js";

export default function ReleaseView({
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
  setShowStartCert,
  onViewFullRecord,
  onBeginOverride,
  releaseVersionPrimarySecondary,
  onCollectingAction,
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
