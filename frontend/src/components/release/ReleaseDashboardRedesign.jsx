import { useEffect } from "react";
import "./ReleaseDashboardRedesign.css";
import { useReleaseDashboardFilters } from "../../hooks/useReleaseDashboardFilters.js";
import { useReleaseDashboardStats } from "../../hooks/useReleaseDashboardStats.js";
import { useReleaseDashboardSidePanel } from "../../hooks/useReleaseDashboardSidePanel.js";
import ReleaseDashboardHeader from "./dashboard/ReleaseDashboardHeader.jsx";
import ReleaseDashboardStats from "./dashboard/ReleaseDashboardStats.jsx";
import ReleaseDashboardTable from "./dashboard/ReleaseDashboardTable.jsx";
import ReleaseDashboardSidePanel from "./dashboard/ReleaseDashboardSidePanel.jsx";
import SetupBanner from "./dashboard/SetupBanner.jsx";
import FirstCertLanding from "./dashboard/FirstCertLanding.jsx";

export function ReleaseDashboard({
  releases = [],
  wsReady = true,
  wsId,
  prodObservationEnabled = false,
  signalCategories = [],
  signalDefinitions = [],
  calcCategoryStatus,
  thresholds = {},
  releaseTypes = [],
  releaseVersionPrimarySecondary,
  formatReleaseAge,
  onNewRelease,
  onViewFullRecord,
  onBeginOverride,
  onCollectingAction,
  onHydrateVisibleSummaries,
  setupChecklist,
  hasMoreReleases = false,
  loadingMoreReleases = false,
  onLoadMoreReleases,
  shippedWithoutCertificationCount = null,
  productionIncidentsCount = null,
  remediationDebtActive = false
}) {
  const filters = useReleaseDashboardFilters(releases);
  const sidePanel = useReleaseDashboardSidePanel({ wsId, prodObservationEnabled, releases });

  useEffect(() => {
    onHydrateVisibleSummaries?.(filters.visibleReleases);
  }, [filters.visibleReleases, onHydrateVisibleSummaries]);

  const { stats, releaseCatStatuses, recentActivity } = useReleaseDashboardStats({
    releases,
    wsId,
    loopReadiness: sidePanel.loopReadiness,
    signalCategories,
    calcCategoryStatus,
    thresholds,
    formatReleaseAge,
    workspaceBypassCount: shippedWithoutCertificationCount,
    productionIncidentsCount,
    remediationDebtActive
  });

  const waitingForFirstPr =
    wsReady && Boolean(setupChecklist?.complete) && !setupChecklist?.loading && releases.length === 0;
  const setupIncomplete = wsReady && setupChecklist && !setupChecklist.loading && !setupChecklist.complete;
  const showFirstCertLanding = waitingForFirstPr || (setupIncomplete && releases.length === 0);

  return (
    <div className="release-redesign">
      <ReleaseDashboardHeader
        activeEnv={filters.activeEnv}
        setActiveEnv={filters.setActiveEnv}
        searchQ={filters.searchQ}
        setSearchQ={filters.setSearchQ}
        onNewRelease={onNewRelease}
      />

      <div className="body-split">
        <div className="content">
          {showFirstCertLanding ? (
            <FirstCertLanding
              setupChecklist={setupChecklist}
              waitingForFirstPr={waitingForFirstPr}
              onNewRelease={onNewRelease}
            />
          ) : (
            <SetupBanner setupChecklist={setupChecklist} />
          )}
          {showFirstCertLanding ? null : <ReleaseDashboardStats wsReady={wsReady} stats={stats} />}
          {showFirstCertLanding ? null : (
          <ReleaseDashboardTable
            wsReady={wsReady}
            releases={releases}
            visibleReleases={filters.visibleReleases}
            activeFilter={filters.activeFilter}
            setActiveFilter={filters.setActiveFilter}
            expandedId={filters.expandedId}
            toggleRow={filters.toggleRow}
            releaseCatStatuses={releaseCatStatuses}
            signalCategories={signalCategories}
            signalDefinitions={signalDefinitions}
            thresholds={thresholds}
            releaseTypes={releaseTypes}
            formatReleaseAge={formatReleaseAge}
            releaseVersionPrimarySecondary={releaseVersionPrimarySecondary}
            onViewFullRecord={onViewFullRecord}
            onBeginOverride={onBeginOverride}
            onCollectingAction={onCollectingAction}
            hasMoreReleases={hasMoreReleases}
            loadingMoreReleases={loadingMoreReleases}
            onLoadMoreReleases={onLoadMoreReleases}
            emptyWedgeLabel={setupChecklist?.triggerLabel}
          />
          )}
        </div>

        {showFirstCertLanding ? null : (
        <ReleaseDashboardSidePanel
          loopReadiness={sidePanel.loopReadiness}
          loopBand={sidePanel.loopBand}
          loopStageRows={sidePanel.loopStageRows}
          stats={stats}
          signalReliabilityComputedAt={sidePanel.signalReliabilityComputedAt}
          reliabilityRows={sidePanel.reliabilityRows}
          recentActivity={recentActivity}
          releaseVersionPrimarySecondary={releaseVersionPrimarySecondary}
        />
        )}
      </div>
    </div>
  );
}

export { ReleaseDashboard as ReleaseDashboardRedesign };
