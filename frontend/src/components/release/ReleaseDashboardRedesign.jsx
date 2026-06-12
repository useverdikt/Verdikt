import "./ReleaseDashboardRedesign.css";
import { useReleaseDashboardFilters } from "../../hooks/useReleaseDashboardFilters.js";
import { useReleaseDashboardStats } from "../../hooks/useReleaseDashboardStats.js";
import { useReleaseDashboardSidePanel } from "../../hooks/useReleaseDashboardSidePanel.js";
import ReleaseDashboardHeader from "./dashboard/ReleaseDashboardHeader.jsx";
import ReleaseDashboardStats from "./dashboard/ReleaseDashboardStats.jsx";
import ReleaseDashboardTable from "./dashboard/ReleaseDashboardTable.jsx";
import ReleaseDashboardSidePanel from "./dashboard/ReleaseDashboardSidePanel.jsx";
import SetupBanner from "./dashboard/SetupBanner.jsx";

export function ReleaseDashboard({
  releases = [],
  wsReady = true,
  wsId,
  prodObservationEnabled = false,
  signalCategories = [],
  calcCategoryStatus,
  thresholds = {},
  releaseTypes = [],
  releaseVersionPrimarySecondary,
  formatReleaseAge,
  onNewRelease,
  onViewFullRecord,
  onBeginOverride,
  onCollectingAction,
  onEnsureReleaseDetail,
  setupChecklist
}) {
  const filters = useReleaseDashboardFilters(releases, { onEnsureReleaseDetail });
  const sidePanel = useReleaseDashboardSidePanel({ wsId, prodObservationEnabled, releases });
  const { stats, releaseCatStatuses, recentActivity } = useReleaseDashboardStats({
    releases,
    wsId,
    loopReadiness: sidePanel.loopReadiness,
    signalCategories,
    calcCategoryStatus,
    thresholds,
    formatReleaseAge
  });

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
          <SetupBanner setupChecklist={setupChecklist} />
          <ReleaseDashboardStats wsReady={wsReady} stats={stats} loopBand={sidePanel.loopBand} />
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
            thresholds={thresholds}
            releaseTypes={releaseTypes}
            formatReleaseAge={formatReleaseAge}
            releaseVersionPrimarySecondary={releaseVersionPrimarySecondary}
            onViewFullRecord={onViewFullRecord}
            onBeginOverride={onBeginOverride}
            onCollectingAction={onCollectingAction}
          />
        </div>

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
      </div>
    </div>
  );
}

export { ReleaseDashboard as ReleaseDashboardRedesign };
