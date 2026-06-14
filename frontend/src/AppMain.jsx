import React, { useEffect, useRef, useState } from "react";
import { getWorkspaceId } from "./lib/apiClient.js";
import { C, T } from "./theme/tokens.js";
import StartCertModal from "./components/app/modals/StartCertModal.jsx";
import UserSetupModal from "./components/app/modals/UserSetupModal.jsx";
import ManualAddModal from "./components/app/modals/ManualAddModal.jsx";
import OverrideModal from "./components/app/modals/OverrideModal.jsx";
import ShareModal from "./components/app/modals/ShareModal.jsx";
import LiveStreamModal from "./components/app/modals/LiveStreamModal.jsx";
import CertificationRecordModal from "./components/app/modals/CertificationRecordModal.jsx";
import Sidebar from "./components/app/Sidebar.jsx";
import ApiBanner from "./components/app/ApiBanner.jsx";
import AppContentSwitch from "./components/app/AppContentSwitch.jsx";
import ThresholdsViewPanel from "./components/app/views/ThresholdsView.jsx";
import AuditViewPanel from "./components/app/views/AuditView.jsx";
import EscalationsViewPanel from "./components/app/views/EscalationsView.jsx";
import TrendViewPanel from "./components/app/views/TrendView.jsx";
import ReleaseViewPanel from "./components/app/views/ReleaseView.jsx";
import {
  S,
  NAV_TO_PATH,
  DEFAULT_THRESHOLDS,
  ROLES,
  canAct,
  RELEASE_TYPES,
  getRegressionRequired,
  SIGNAL_CATEGORIES,
  SIGNAL_SOURCES,
  evaluateSignal,
  formatReleaseDisplayName,
  releaseVersionPrimarySecondary,
  trendChartXLabel,
  TREND_CHART_MAX_POINTS,
  calcVerdict,
  calcCategoryStatus,
  fmtVal,
  catStatusColor,
  findSignalMetaById,
  formatAiPct,
  buildRegressionOverrideContext,
  scoreJustification,
  releaseRiskScore,
  genCertSummary,
  sidebarStatusLabel,
  formatSidebarReleaseAge
} from "./app/main/appMainLogic.js";
import { SignalDetailPanel } from "./components/app/main/AppMainPanels.jsx";
import { hasBackend } from "./lib/hasBackend.js";
import { normalizeReleaseStatus, UI_RELEASE_STATUS } from "./lib/releaseStatus.js";
import { useLoopReadinessNudge } from "./hooks/useLoopReadinessNudge.js";
import { useAppNavigation } from "./hooks/useAppNavigation.js";
import { useAppProject } from "./hooks/useAppProject.js";
import { useAppToast } from "./hooks/useAppToast.js";
import { useWorkspaceSync, useAuditRecordOpener } from "./hooks/useWorkspaceSync.js";
import { useReleaseSidebar } from "./hooks/useReleaseSidebar.js";
import { useReleaseActions } from "./hooks/useReleaseActions.js";
import LoopReadinessNudge from "./components/app/LoopReadinessNudge.jsx";

export default function App() {
  const { navigate, nav, isMobile } = useAppNavigation();
  const project = useAppProject();
  const { toast, showToast } = useAppToast();

  const workspace = useWorkspaceSync(navigate, nav);
  const {
    wsReady,
    releases,
    setReleases,
    selectedId,
    setSelectedId,
    thresholds,
    setThresholds,
    thresholdRequired,
    setThresholdRequired,
    auditLog,
    currentUser,
    setCurrentUser,
    apiBanner,
    setApiBanner,
    workspaceSyncing,
    thresholdSuggestions,
    thresholdSuggestNote,
    refreshWorkspaceFromServer,
    loadThresholdSuggestions,
    addAudit,
    refreshReleaseFromBackend,
    ensureReleaseDetail,
    hydrateVisibleSummaries,
    refreshAuditFromServer,
    openAuditRecord,
    loadMoreReleases,
    releasesNextBefore,
    releasesLoadingMore,
    loadMoreAudit,
    auditNextBefore,
    auditLoadingMore
  } = workspace;

  const {
    sortedReleasesForSidebar,
    sidebarReleaseGroups,
    collapsedSidebarDayKeys,
    setCollapsedSidebarDayKeys,
    releaseSidebarCounts,
    sidebarRecById
  } = useReleaseSidebar(releases, thresholds, nav);

  const [showStartCert, setShowStartCert] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareRelease, setShareRelease] = useState(null);
  const [liveStreamRelease, setLiveStreamRelease] = useState(null);
  const [showReevalConfirm, setShowReevalConfirm] = useState(false);
  const [reEvaluating, setReEvaluating] = useState(false);
  const [_headerActionsOpen, setHeaderActionsOpen] = useState(false);
  const [detailCat, setDetailCat] = useState(null);
  const [auditDetail, setAuditDetail] = useState(null);
  const headerActionsRef = useRef(null);

  const current = releases.find((r) => r.id === selectedId) || releases[0];

  const actions = useReleaseActions({
    navigate,
    releases,
    setReleases,
    selectedId,
    setSelectedId,
    thresholds,
    setThresholds,
    thresholdRequired,
    setThresholdRequired,
    currentUser,
    current,
    showToast,
    setApiBanner,
    addAudit,
    refreshReleaseFromBackend,
    refreshAuditFromServer,
    refreshWorkspaceFromServer: workspace.refreshWorkspaceFromServer,
    loadThresholdSuggestions,
    modalActions: {
      setShowStartCert,
      setShowManualAdd,
      setShowOverride,
      setShowReevalConfirm,
      setReEvaluating,
      reEvaluating,
      toastGreen: C.green,
      toastAmber: C.amber,
      toastRed: C.red,
      toastAccent: C.accent,
      setLiveStreamRelease
    }
  });

  const { showLoopNudge, dismissLoopNudge } = useLoopReadinessNudge({
    releases,
    navigate,
    prodObservationEnabled: !!project.prodObservation
  });

  const handleAuditSelect = useAuditRecordOpener({
    openAuditRecord,
    setAuditDetail,
    showToast,
    toastColor: C.red
  });

  useEffect(() => {
    setShowReevalConfirm(false);
  }, [selectedId]);

  useEffect(() => {
    setHeaderActionsOpen(false);
  }, [selectedId, nav]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!headerActionsRef.current) return;
      if (!headerActionsRef.current.contains(e.target)) setHeaderActionsOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setHeaderActionsOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const uncertifiedRelease = releases.find(
    (r) => normalizeReleaseStatus(r.status) === UI_RELEASE_STATUS.UNCERTIFIED
  );

  const navItems = [
    { id: "release", label: "Release Signals", icon: "◈" },
    { id: "trend", label: "Trend", icon: "∿" },
    { id: "thresholds", label: "Thresholds", icon: "⌗" },
    { id: "audit", label: "Audit Trail", icon: "≡" },
    { id: "escalations", label: "Escalations", icon: "!" },
    { id: "intelligence", label: "Intelligence", icon: "⊹" },
    { id: "settings", label: "Settings", icon: "⚙" }
  ];

  return (
    <>
      <ApiBanner message={apiBanner} onDismiss={() => setApiBanner(null)} />
      <LoopReadinessNudge
        visible={showLoopNudge}
        apiBannerVisible={!!apiBanner}
        onDismiss={dismissLoopNudge}
        onConnect={() => {
          dismissLoopNudge();
          navigate("/settings");
        }}
      />
      <div
        style={{
          display: "flex",
          height: isMobile ? "auto" : apiBanner ? "calc(100vh - 48px)" : "100vh",
          minHeight: apiBanner ? "calc(100vh - 48px)" : "100vh",
          flexDirection: isMobile ? "column" : "row",
          background: C.bg,
          fontFamily: C.sans,
          color: C.text,
          overflow: isMobile ? "auto" : "hidden"
        }}
      >
        <Sidebar
          isMobile={isMobile}
          project={project}
          nav={nav}
          navItems={navItems}
          styles={T}
          dataStrongStyle={T.dataStrong}
          overlineStyle={T.overline}
          releaseSidebarCounts={releaseSidebarCounts}
          hasBackend={hasBackend}
          workspaceSyncing={workspaceSyncing}
          refreshWorkspaceFromServer={refreshWorkspaceFromServer}
          sidebarReleaseGroups={sidebarReleaseGroups}
          collapsedSidebarDayKeys={collapsedSidebarDayKeys}
          setCollapsedSidebarDayKeys={setCollapsedSidebarDayKeys}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          sidebarRecById={sidebarRecById}
          releaseTypes={RELEASE_TYPES}
          formatSidebarReleaseAge={formatSidebarReleaseAge}
          sidebarStatusLabel={sidebarStatusLabel}
          releaseRiskScore={releaseRiskScore}
          thresholds={thresholds}
          formatReleaseDisplayName={formatReleaseDisplayName}
          currentUser={currentUser}
          canAct={canAct}
          showReevalConfirm={showReevalConfirm}
          setShowReevalConfirm={setShowReevalConfirm}
          reEvaluating={reEvaluating}
          handleConfirmReevaluation={actions.handleConfirmReevaluation}
          setShowStartCert={setShowStartCert}
          onNavigate={(id) => {
            if (id === "settings") navigate("/settings");
            else if (id === "intelligence") navigate("/intelligence");
            else navigate(NAV_TO_PATH[id] || "/releases");
          }}
          roles={ROLES}
          uncertifiedRelease={uncertifiedRelease}
          setCurrentUser={setCurrentUser}
          setLocalStore={S.set}
          onLogout={() => {
            localStorage.removeItem("vdk3_currentUser");
            localStorage.removeItem("vdk3_auth_token");
            window.location.href = "/login";
          }}
        />
        <AppContentSwitch
          isMobile={isMobile}
          nav={nav}
          releaseContent={
            <ReleaseViewPanel
              current={current}
              releases={sortedReleasesForSidebar}
              wsReady={wsReady}
              wsId={getWorkspaceId()}
              prodObservationEnabled={!!project.prodObservation}
              formatReleaseAge={formatSidebarReleaseAge}
              thresholds={thresholds}
              releaseTypes={RELEASE_TYPES}
              signalCategories={SIGNAL_CATEGORIES}
              calcCategoryStatus={calcCategoryStatus}
              setDetailCat={setDetailCat}
              setShowStartCert={setShowStartCert}
              onViewFullRecord={setAuditDetail}
              onBeginOverride={(release) => {
                if (release?.id) setSelectedId(release.id);
                setShowOverride(true);
              }}
              handleSimulateSignal={actions.handleSimulateSignal}
              handleRunVerdict={actions.handleRunVerdict}
              signalSources={SIGNAL_SOURCES}
              releaseVersionPrimarySecondary={releaseVersionPrimarySecondary}
              onCollectingAction={actions.handleCollectingAction}
              onEnsureReleaseDetail={ensureReleaseDetail}
              onHydrateVisibleSummaries={hydrateVisibleSummaries}
              hasMoreReleases={Boolean(releasesNextBefore)}
              loadingMoreReleases={releasesLoadingMore}
              onLoadMoreReleases={loadMoreReleases}
              navigate={navigate}
            />
          }
          trendContent={
            <TrendViewPanel
              releases={releases}
              wsReady={wsReady}
              signalCategories={SIGNAL_CATEGORIES}
              thresholds={thresholds}
              trendChartMaxPoints={TREND_CHART_MAX_POINTS}
              getRegressionRequired={getRegressionRequired}
              evaluateSignal={evaluateSignal}
              calcCategoryStatus={calcCategoryStatus}
              catStatusColor={catStatusColor}
              trendChartXLabel={trendChartXLabel}
              formatReleaseDisplayName={formatReleaseDisplayName}
            />
          }
          thresholdsContent={
            <ThresholdsViewPanel
              thresholds={thresholds}
              thresholdRequired={thresholdRequired}
              defaultThresholds={DEFAULT_THRESHOLDS}
              signalCategories={SIGNAL_CATEGORIES}
              isMobile={isMobile}
              currentUser={currentUser}
              canAct={canAct}
              suggestions={thresholdSuggestions}
              suggestNote={thresholdSuggestNote}
              onApplySuggestion={actions.handleApplySuggestion}
              onDismissSuggestion={actions.handleDismissSuggestion}
              onSave={actions.handleThresholdSave}
            />
          }
          auditContent={
            <AuditViewPanel
              auditLog={auditLog}
              releases={releases}
              isMobile={isMobile}
              wsReady={wsReady}
              wsId={getWorkspaceId()}
              hasMoreAudit={Boolean(auditNextBefore)}
              loadingMoreAudit={auditLoadingMore}
              onLoadMoreAudit={loadMoreAudit}
              onSelectRelease={handleAuditSelect}
            />
          }
          escalationsContent={
            <EscalationsViewPanel
              isMobile={isMobile}
              wsReady={wsReady}
              currentUser={currentUser}
              onSelectRelease={(r) => {
                if (r?.backendReleaseId) {
                  const match = releases.find((x) => x.backendReleaseId === r.backendReleaseId || x.id === r.backendReleaseId);
                  if (match?.id) setSelectedId(match.id);
                }
                navigate("/releases");
              }}
            />
          }
        />
        {!hasBackend() && !currentUser && (
          <UserSetupModal
            roles={ROLES}
            onSave={(user) => {
              S.set("currentUser", user);
              setCurrentUser(user);
            }}
          />
        )}
        {showStartCert && (
          <StartCertModal
            onClose={() => setShowStartCert(false)}
            onStart={actions.handleStartCert}
            releaseTypes={RELEASE_TYPES}
          />
        )}
        {showManualAdd && (
          <ManualAddModal
            onClose={() => setShowManualAdd(false)}
            onAddSingle={actions.handleManualAddSingle}
            onImportCSV={actions.handleManualImportCSV}
            releaseTypes={RELEASE_TYPES}
          />
        )}
        {showOverride && current && (
          <OverrideModal
            key={current.backendReleaseId || current.id}
            release={current}
            thresholds={thresholds}
            currentUser={currentUser}
            onClose={() => setShowOverride(false)}
            onConfirm={actions.handleOverrideConfirm}
            roles={ROLES}
            calcVerdict={calcVerdict}
            fmtVal={fmtVal}
            buildRegressionOverrideContext={buildRegressionOverrideContext}
            findSignalMetaById={findSignalMetaById}
            formatAiPct={formatAiPct}
            scoreJustification={scoreJustification}
          />
        )}
        {detailCat && current && (
          <SignalDetailPanel
            catId={detailCat}
            release={current}
            thresholds={thresholds}
            releaseType={current.releaseType}
            onClose={() => setDetailCat(null)}
          />
        )}
        {auditDetail && (
          <CertificationRecordModal
            release={auditDetail}
            thresholds={thresholds}
            onClose={() => setAuditDetail(null)}
            onShareSnapshot={(r) => {
              setShareRelease(r);
              setShowShare(true);
            }}
            calcVerdict={calcVerdict}
            releaseTypes={RELEASE_TYPES}
            signalCategories={SIGNAL_CATEGORIES}
            calcCategoryStatus={calcCategoryStatus}
            catStatusColor={catStatusColor}
            getRegressionRequired={getRegressionRequired}
            evaluateSignal={evaluateSignal}
            fmtVal={fmtVal}
            backendReleaseId={auditDetail.backendReleaseId || auditDetail.id}
          />
        )}
        {showShare && shareRelease && (
          <ShareModal
            release={shareRelease}
            thresholds={thresholds}
            project={project}
            onClose={() => {
              setShowShare(false);
              setShareRelease(null);
            }}
            calcVerdict={calcVerdict}
            calcCategoryStatus={calcCategoryStatus}
            releaseTypes={RELEASE_TYPES}
            signalCategories={SIGNAL_CATEGORIES}
            catStatusColor={catStatusColor}
            fmtVal={fmtVal}
            genCertSummary={genCertSummary}
          />
        )}
        {liveStreamRelease && (
          <LiveStreamModal release={liveStreamRelease} onClose={() => setLiveStreamRelease(null)} />
        )}
        {toast && (
          <div
            className="fade-up"
            style={{
              position: "fixed",
              bottom: 24,
              right: 24,
              background: toast.c,
              color: "#000",
              borderRadius: 10,
              padding: "12px 22px",
              fontWeight: 700,
              fontSize: 13,
              boxShadow: `0 8px 32px ${toast.c}55`,
              zIndex: 300,
              fontFamily: C.mono
            }}
          >
            {toast.msg}
          </div>
        )}
      </div>
    </>
  );
}
