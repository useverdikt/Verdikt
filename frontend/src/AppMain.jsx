import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { SCREENSHOT_GALLERY_DEMO_EMAIL, SCREENSHOT_SIM_RELEASES } from "./app/screenshotSimReleases.js";
import { normalizeStoredProject } from "./lib/projectEnv.js";
import { apiGet, apiPost, getWorkspaceId } from "./lib/apiClient.js";
import { C, T } from "./theme/tokens.js";
import StartCertModal from "./components/app/modals/StartCertModal.jsx";
import UserSetupModal from "./components/app/modals/UserSetupModal.jsx";
import ManualAddModal from "./components/app/modals/ManualAddModal.jsx";
import OverrideModal from "./components/app/modals/OverrideModal.jsx";
import ShareModal from "./components/app/modals/ShareModal.jsx";
import CertificationRecordModal from "./components/app/modals/CertificationRecordModal.jsx";
import Sidebar from "./components/app/Sidebar.jsx";
import ApiBanner from "./components/app/ApiBanner.jsx";
import AppContentSwitch from "./components/app/AppContentSwitch.jsx";
import ThresholdsViewPanel from "./components/app/views/ThresholdsView.jsx";
import AuditViewPanel from "./components/app/views/AuditView.jsx";
import TrendViewPanel from "./components/app/views/TrendView.jsx";
import ReleaseViewPanel from "./components/app/views/ReleaseView.jsx";
import {
  S,
  NAV_TO_PATH,
  LEGACY_TAB_TO_PATH,
  nowTs,
  mapWorkspaceAuditEventsToLog,
  formatReleaseDisplayName,
  releaseVersionPrimarySecondary,
  trendChartXLabel,
  TREND_CHART_MAX_POINTS,
  ROLES,
  canAct,
  RELEASE_TYPES,
  getRegressionRequired,
  SIGNAL_CATEGORIES,
  DEFAULT_THRESHOLDS,
  DEMO_RELEASES,
  DEFAULT_AUDIT,
  evaluateSignal,
  SIGNAL_SOURCES,
  mapBackendDetailToUi,
  semverDesc,
  releaseSortTimestampMs,
  sidebarStatusLabel,
  formatSidebarReleaseAge,
  releaseDayKeyLocal,
  formatSidebarDayHeading,
  calcVerdict,
  calcCategoryStatus,
  fmtVal,
  catStatusColor,
  findSignalMetaById,
  formatAiPct,
  buildRegressionOverrideContext,
  scoreJustification,
  releaseRiskScore,
  genCertSummary
} from "./app/main/appMainLogic.js";
import { SignalDetailPanel } from "./components/app/main/AppMainPanels.jsx";
import { hasBackend } from "./lib/hasBackend.js";
import { useLoopReadinessNudge } from "./hooks/useLoopReadinessNudge.js";
import LoopReadinessNudge from "./components/app/LoopReadinessNudge.jsx";

export default function App() {
  const [releases, setReleases] = useState(() => {
    const s = S.get("releases", null);
    return Array.isArray(s) && s.length > 0 ? s : SCREENSHOT_SIM_RELEASES;
  });
  const [selectedId, setSelectedId] = useState(() => {
    const s = S.get("releases", null);
    const list = Array.isArray(s) && s.length > 0 ? s : SCREENSHOT_SIM_RELEASES;
    return list[0]?.id;
  });
  const [thresholds, setThresholds] = useState(() => S.get("thresholds", DEFAULT_THRESHOLDS));
  const [auditLog, setAuditLog] = useState(() => S.get("audit", DEFAULT_AUDIT));
  const [currentUser, setCurrentUser] = useState(() => {
    const u = S.get("currentUser", null);
    if (u && u.role === "viewer") return { ...u, role: "engineer" };
    return u;
  });
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const tab = new URLSearchParams(location.search).get("tab");
    if (!tab) return;
    const dest = LEGACY_TAB_TO_PATH[tab];
    if (!dest) return;
    navigate(dest, { replace: true });
  }, [location.search, navigate]);
  useEffect(() => {
    const p = location.pathname.replace(/\/$/, "") || "/";
    const known = /* @__PURE__ */ new Set(["/releases", "/trends", "/thresholds", "/audit"]);
    if (!known.has(p)) navigate("/releases", { replace: true });
  }, [location.pathname, navigate]);
  const nav = useMemo(() => {
    const p = location.pathname.replace(/\/$/, "") || "/";
    const map = {
      "/releases": "release",
      "/trends": "trend",
      "/thresholds": "thresholds",
      "/audit": "audit"
    };
    return map[p] || "release";
  }, [location.pathname]);
  const [showStartCert, setShowStartCert] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareRelease, setShareRelease] = useState(null);
  const [showReevalConfirm, setShowReevalConfirm] = useState(false);
  const [reEvaluating, setReEvaluating] = useState(false);
  const [_headerActionsOpen, setHeaderActionsOpen] = useState(false);
  const [detailCat, setDetailCat] = useState(null);
  const [auditDetail, setAuditDetail] = useState(null);
  const [toast, setToast] = useState(null);
  const [apiBanner, setApiBanner] = useState(null);
  const [_releasesTotalCount, setReleasesTotalCount] = useState(null);
  const [releasesNextBefore, setReleasesNextBefore] = useState(null);
  const [releasesLoadingMore, setReleasesLoadingMore] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [collapsedSidebarDayKeys, setCollapsedSidebarDayKeys] = useState(() => /* @__PURE__ */ new Set());
  const sidebarCollapsedInitializedForWs = React.useRef(null);
  const knownSidebarDayKeysRef = React.useRef(/* @__PURE__ */ new Set());
  const prevNavRef = React.useRef(nav);
  const headerActionsRef = React.useRef(null);
  const project = (() => {
    const parsed = S.get("project", null);
    const raw = localStorage.getItem("vdk3_project");
    let fallback = null;
    if (!parsed && raw) {
      try {
        fallback = JSON.parse(raw);
      } catch {
        fallback = { name: String(raw), feature: "", env: "UAT" };
      }
    }
    const p = parsed || fallback || {};
    const orgName = (localStorage.getItem("vdk3_org") || "").trim();
    const n = normalizeStoredProject(p);
    return {
      name: p.name && String(p.name).trim() || orgName || "Project",
      feature: p.feature && String(p.feature).trim() || "",
      env: n.env && String(n.env).trim() || "UAT",
      certEnvs: n.certEnvs,
      prodObservation: n.prodObservation
    };
  })();
  const isMobile = viewportWidth <= 900;
  const [workspaceSyncing, setWorkspaceSyncing] = useState(false);

  const { showLoopNudge, dismissLoopNudge } = useLoopReadinessNudge({
    releases,
    navigate,
    prodObservationEnabled: !!project.prodObservation
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
  useEffect(() => {
    if (hasBackend()) return;
    S.set("releases", releases);
  }, [releases]);
  useEffect(() => {
    if (hasBackend()) return;
    S.set("thresholds", thresholds);
  }, [thresholds]);
  useEffect(() => {
    if (hasBackend()) return;
    S.set("audit", auditLog);
  }, [auditLog]);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const refreshWorkspaceFromServer = React.useCallback(async (opts = {}) => {
    const { cancelledRef, manual } = opts;
    if (!hasBackend()) return;
    const isCancelled = () => cancelledRef && cancelledRef.cancelled;
    if (manual) setWorkspaceSyncing(true);
    try {
      if (!isCancelled()) setApiBanner(null);
      const [thData, relData, auditData] = await Promise.all(
        [
          apiGet(`/api/workspaces/${getWorkspaceId()}/thresholds`, { navigate }),
          apiGet(`/api/workspaces/${getWorkspaceId()}/releases?limit=50`, { navigate }),
          apiGet(`/api/workspaces/${getWorkspaceId()}/audit`, { navigate })
        ]
      );
      if (isCancelled()) return;
      const map = thData?.thresholds || {};
      setThresholds((prev) => {
        const next = { ...prev };
        Object.entries(map).forEach(([signalId, cfg]) => {
          if (cfg?.min !== null && cfg?.min !== void 0) next[signalId] = cfg.min;
          if (cfg?.max !== null && cfg?.max !== void 0) next[signalId] = cfg.max;
        });
        return next;
      });
      const rows = relData?.releases || [];
      setReleasesNextBefore(relData?.next_before || null);
      if (currentUser?.email === SCREENSHOT_GALLERY_DEMO_EMAIL) {
        setReleasesTotalCount(SCREENSHOT_SIM_RELEASES.length);
        setReleases([...SCREENSHOT_SIM_RELEASES]);
        setSelectedId((sel) =>
          SCREENSHOT_SIM_RELEASES.some((r) => r.id === sel) ? sel : SCREENSHOT_SIM_RELEASES[0]?.id
        );
      } else if (rows.length) {
        setReleasesTotalCount(typeof relData?.total_count === "number" ? relData.total_count : rows.length);
        const details = await Promise.all(rows.map((r) => apiGet(`/api/releases/${r.id}`, { navigate }).catch(() => null)));
        if (isCancelled()) return;
        const mapped = details.map((d) => (d ? mapBackendDetailToUi(d) : null)).filter(Boolean);
        if (mapped.length) {
          setReleases((prev) => {
            const mappedIds = new Set(mapped.map((r) => r.id));
            const demos = SCREENSHOT_SIM_RELEASES.filter((d) => !mappedIds.has(d.id));
            const demoIds = new Set(DEMO_RELEASES.map((r) => r.id));
            const localOnly = prev.filter(
              (r) => !r.backendReleaseId && !demoIds.has(r.id) && !mappedIds.has(r.id)
            );
            return [...demos, ...mapped, ...localOnly];
          });
          setSelectedId((sel) => {
            if (mapped.some((r) => r.id === sel)) return sel;
            if (SCREENSHOT_SIM_RELEASES.some((r) => r.id === sel)) return sel;
            return mapped[0]?.id ?? SCREENSHOT_SIM_RELEASES[0]?.id;
          });
        }
      } else {
        setReleasesTotalCount(typeof relData?.total_count === "number" ? relData.total_count : rows.length);
        setReleases((prev) => (prev.length > 0 ? prev : [...SCREENSHOT_SIM_RELEASES]));
      }
      setAuditLog(mapWorkspaceAuditEventsToLog(auditData?.events || []));
    } catch (e) {
      if (!isCancelled()) setApiBanner(e.message || "Failed to sync workspace from server");
    } finally {
      if (manual) setWorkspaceSyncing(false);
    }
  }, [navigate, currentUser?.email]);
  const refreshAuditFromServer = React.useCallback(async () => {
    if (!hasBackend()) return;
    try {
      setApiBanner(null);
      const data = await apiGet(`/api/workspaces/${getWorkspaceId()}/audit`, { navigate });
      setAuditLog(mapWorkspaceAuditEventsToLog(data?.events || []));
    } catch (e) {
      setApiBanner(e.message || "Failed to refresh audit log");
    }
  }, [navigate]);
  useEffect(() => {
    if (!hasBackend()) return;
    const cancelledRef = { cancelled: false };
    void refreshWorkspaceFromServer({ cancelledRef });
    return () => {
      cancelledRef.cancelled = true;
    };
  }, [navigate, refreshWorkspaceFromServer]);
  useEffect(() => {
    if (currentUser) S.set("currentUser", currentUser);
  }, [currentUser]);
  const current = releases.find((r) => r.id === selectedId) || releases[0];
  const sortedReleasesForSidebar = React.useMemo(() => {
    return [...releases].sort((a, b) => {
      const ta = releaseSortTimestampMs(a);
      const tb = releaseSortTimestampMs(b);
      if (ta != null && tb != null && ta !== tb) return tb - ta;
      if (ta != null && tb == null) return -1;
      if (ta == null && tb != null) return 1;
      return semverDesc(a.version, b.version);
    });
  }, [releases]);
  const sidebarReleaseGroups = React.useMemo(() => {
    const byDay = /* @__PURE__ */ new Map();
    for (const r of sortedReleasesForSidebar) {
      const k = releaseDayKeyLocal(r);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(r);
    }
    const keys = [...byDay.keys()].sort((a, b) => {
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return b.localeCompare(a);
    });
    return keys.map((dayKey) => ({
      dayKey,
      label: formatSidebarDayHeading(dayKey),
      releases: byDay.get(dayKey)
    }));
  }, [sortedReleasesForSidebar]);
  useLayoutEffect(() => {
    const ws = getWorkspaceId();
    if (sidebarReleaseGroups.length === 0) return;
    if (sidebarCollapsedInitializedForWs.current === ws) return;
    sidebarCollapsedInitializedForWs.current = ws;
    knownSidebarDayKeysRef.current = new Set(sidebarReleaseGroups.map((g) => g.dayKey));
    setCollapsedSidebarDayKeys(new Set(sidebarReleaseGroups.map((g) => g.dayKey)));
  }, [sidebarReleaseGroups]);
  useEffect(() => {
    if (sidebarReleaseGroups.length === 0) return;
    setCollapsedSidebarDayKeys((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const g of sidebarReleaseGroups) {
        if (!knownSidebarDayKeysRef.current.has(g.dayKey)) {
          knownSidebarDayKeysRef.current.add(g.dayKey);
          next.add(g.dayKey);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sidebarReleaseGroups]);
  useEffect(() => {
    if (nav === "release" && prevNavRef.current !== "release" && sidebarReleaseGroups.length > 0) {
      setCollapsedSidebarDayKeys(new Set(sidebarReleaseGroups.map((g) => g.dayKey)));
    }
    prevNavRef.current = nav;
  }, [nav, sidebarReleaseGroups]);
  const releaseSidebarCounts = React.useMemo(() => {
    const nCert = releases.filter((r) => r.status === "shipped").length;
    const nBlocked = releases.filter((r) => r.status === "blocked").length;
    const nProgress = releases.filter((r) => r.status === "pending" || r.status === "collecting").length;
    const nOv = releases.filter((r) => r.status === "overridden").length;
    // Total "passed" = purely certified + certified-with-override
    const nPassed = nCert + nOv;
    const nTotal = releases.length;
    return { nCert, nBlocked, nProgress, nOv, nPassed, nTotal };
  }, [releases]);
  const sidebarRecById = React.useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const r of sortedReleasesForSidebar) {
      m.set(r.id, calcVerdict(r.signals, thresholds, r.releaseType).recommendation);
    }
    return m;
  }, [sortedReleasesForSidebar, thresholds]);
  const showToast = (msg, c) => {
    setToast({
      msg,
      c
    });
    setTimeout(() => setToast(null), 3200);
  };
  const addAudit = (e) => setAuditLog((p) => [{
    id: Date.now(),
    ...e
  }, ...p]);
  const _handleShip = () => {
    const actor = currentUser ? `${currentUser.name}, ${ROLES[currentUser.role]?.title || "User"}` : "You";
    setReleases((p) => p.map((r) => r.id === selectedId ? {
      ...r,
      status: "shipped",
      shippedBy: actor
    } : r));
    addAudit({
      ts: nowTs(),
      event: "Release shipped",
      release: current.version,
      actor,
      detail: "All thresholds met. Release certified and on permanent record."
    });
    showToast("✓ Certified. Release is on record.", C.green);
  };
  const refreshReleaseFromBackend = async (backendReleaseId) => {
    if (!hasBackend() || !backendReleaseId) return;
    try {
      setApiBanner(null);
      const detail = await apiGet(`/api/releases/${backendReleaseId}`, { navigate });
      const mapped = mapBackendDetailToUi(detail);
      setReleases((p) => p.map((r) => r.backendReleaseId === backendReleaseId ? {
        ...mapped,
        id: r.id
      } : r));
    } catch (e) {
      setApiBanner(e.message || "Failed to refresh release from server");
    }
  };
  const _loadMoreReleases = async () => {
    if (!hasBackend() || !releasesNextBefore || releasesLoadingMore) return;
    setReleasesLoadingMore(true);
    try {
      setApiBanner(null);
      const data = await apiGet(
        `/api/workspaces/${getWorkspaceId()}/releases?limit=50&before=${encodeURIComponent(releasesNextBefore)}`,
        { navigate }
      );
      const rows = data?.releases || [];
      setReleasesNextBefore(data?.next_before || null);
      const details = await Promise.all(rows.map((r) => apiGet(`/api/releases/${r.id}`, { navigate }).catch(() => null)));
      const mapped = details.map((d) => d ? mapBackendDetailToUi(d) : null).filter(Boolean);
      if (mapped.length) {
        setReleases((prev) => [...prev, ...mapped]);
      }
    } catch (e) {
      setApiBanner(e.message || "Failed to load more releases");
    } finally {
      setReleasesLoadingMore(false);
    }
  };
  const _handleIntelligenceDecision = async (decision) => {
    const active = releases.find((r) => r.id === selectedId);
    const backendId = active?.backendReleaseId;
    const decidedAt = (/* @__PURE__ */ new Date()).toISOString();
    const localPayload = {
      decision: String(decision),
      notes: "",
      actor: currentUser?.email || currentUser?.name || "local",
      decided_at: decidedAt
    };
    if (!backendId) {
      if (!active) return;
      setReleases((p) => p.map((r) => r.id === selectedId ? {
        ...r,
        intelligence: {
          ...r.intelligence || {},
          decision: localPayload
        }
      } : r));
      showToast(`Decision saved locally (${decision}) — sync a server release to persist on the backend`, C.amber);
      return;
    }
    if (!hasBackend()) {
      showToast("Backend required to persist intelligence decisions", C.amber);
      return;
    }
    try {
      await apiPost(`/api/releases/${backendId}/intelligence/decision`, { decision }, { navigate });
      await refreshReleaseFromBackend(backendId);
      await refreshAuditFromServer();
      showToast(`Decision recorded: ${decision}`, C.green);
    } catch (e) {
      setApiBanner(e.message || "Intelligence decision failed");
      showToast("Could not record intelligence decision (check login and release sync)", C.red);
    }
  };
  const _handleIntelligenceOutcome = async (label) => {
    const active = releases.find((r) => r.id === selectedId);
    const backendId = active?.backendReleaseId;
    const decidedAt = (/* @__PURE__ */ new Date()).toISOString();
    const localPayload = {
      label: String(label),
      notes: "",
      observed_at: decidedAt,
      recorded_at: decidedAt
    };
    if (!backendId) {
      if (!active) return;
      setReleases((p) => p.map((r) => r.id === selectedId ? {
        ...r,
        intelligence: {
          ...r.intelligence || {},
          outcome: localPayload
        }
      } : r));
      showToast(`Outcome saved locally (${label}) — sync a server release to persist on the backend`, C.amber);
      return;
    }
    if (!hasBackend()) {
      showToast("Backend required to persist intelligence outcomes", C.amber);
      return;
    }
    try {
      await apiPost(`/api/releases/${backendId}/intelligence/outcome`, { label }, { navigate });
      await refreshReleaseFromBackend(backendId);
      await refreshAuditFromServer();
      showToast(`Outcome recorded: ${label}`, C.green);
    } catch (e) {
      setApiBanner(e.message || "Intelligence outcome failed");
      showToast("Could not record intelligence outcome (check login and release sync)", C.red);
    }
  };
  const handleOverrideConfirm = async (owner, payload) => {
    const active = releases.find((r) => r.id === selectedId);
    const backendId = active?.backendReleaseId;
    const justification = payload?.justification ?? "";
    const impact_summary = payload?.impact_summary ?? "";
    const mitigation_plan = payload?.mitigation_plan ?? "";
    const follow_up_due_date = payload?.follow_up_due_date ?? "";
    if (hasBackend() && backendId) {
      try {
        setApiBanner(null);
        await apiPost(
          `/api/releases/${backendId}/override`,
          {
            approver_type: "PERSON",
            approver_name: owner,
            approver_role: owner.split(",")[1]?.trim() || "Approver",
            justification,
            metadata: {
              source: "dashboard",
              impact_summary,
              mitigation_plan,
              follow_up_due_date
            }
          },
          { navigate }
        );
        await refreshReleaseFromBackend(backendId);
        await refreshAuditFromServer();
      } catch (e) {
        setApiBanner(e.message || "Override request failed");
        showToast("Override not saved — fix errors and try again", C.red);
        return;
      }
    }
    setReleases((p) => p.map((r) => r.id === selectedId ? {
      ...r,
      status: "overridden",
      overrideBy: owner,
      overrideReason: justification
    } : r));
    if (!hasBackend() || !backendId) {
      addAudit({
        ts: nowTs(),
        event: "Override approved",
        release: current.version,
        actor: owner,
        detail: `Shipped below threshold. Justification on permanent record.`
      });
    }
    setShowOverride(false);
    showToast("⚠ Shipped uncertified. Certified with override — permanently on record.", C.amber);
  };
  const handleStartCert = async ({ version, buildRef, relType }) => {
    const id = `rc-${version.replace(/[^a-zA-Z0-9.]/g, "")}`;
    let backendReleaseId = null;
    if (hasBackend()) {
      try {
        const created = await apiPost(
          `/api/workspaces/${getWorkspaceId()}/releases`,
          {
            version,
            release_type: relType,
            environment: project.env?.toLowerCase?.() || "pre-prod"
          },
          { navigate }
        );
        backendReleaseId = created?.id || null;
      } catch {
        showToast("Backend unavailable — using local mode", C.amber);
      }
    }
    const rel = {
      id,
      version,
      buildRef,
      date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      status: "collecting",
      releaseType: relType,
      backendReleaseId,
      signals: {},
      sources: SIGNAL_SOURCES.map((s) => ({ ...s, status: "waiting" }))
    };
    setReleases((p) => [rel, ...p]);
    setSelectedId(id);
    setShowStartCert(false);
    navigate("/releases", { replace: true });
    showToast(`Certification session opened for ${version}`, C.amber);
  };
  const handleManualAddSingle = async ({ version, date, releaseType }) => {
    const id = `rc-${version.replace(/[^a-zA-Z0-9.]/g, "")}`;
    let backendReleaseId = null;
    if (hasBackend()) {
      try {
        const created = await apiPost(
          `/api/workspaces/${getWorkspaceId()}/releases`,
          {
            version,
            release_type: releaseType,
            environment: project.env?.toLowerCase?.() || "pre-prod"
          },
          { navigate }
        );
        backendReleaseId = created?.id || null;
      } catch {
        showToast("Backend unavailable — using local mode", C.amber);
      }
    }
    const rel = {
      id,
      version,
      date: date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      status: "collecting",
      releaseType,
      backendReleaseId,
      signals: {},
      sources: []
    };
    setReleases((p) => [rel, ...p]);
    setSelectedId(id);
    setShowManualAdd(false);
    navigate("/releases", { replace: true });
    addAudit({ ts: nowTs(), event: "Release added manually", release: version, actor: "Manual", detail: `No integration — ${version} added for certification tracking.` });
    showToast(`${version} added. Run verdict or record override when ready.`, C.green);
  };
  const handleManualImportCSV = (rows) => {
    const newReleases = rows.map(({ version, date, releaseType }) => {
      const id = `rc-${version.replace(/[^a-zA-Z0-9.]/g, "")}`;
      return {
        id,
        version,
        date: date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        status: "collecting",
        releaseType,
        signals: {},
        sources: []
      };
    });
    setReleases((p) => [...newReleases, ...p]);
    if (newReleases.length) setSelectedId(newReleases[0].id);
    setShowManualAdd(false);
    navigate("/releases", { replace: true });
    addAudit({ ts: nowTs(), event: "Releases imported from CSV", release: `${newReleases.length} releases`, actor: "Manual", detail: `Imported ${newReleases.length} release(s) without integration.` });
    showToast(`${newReleases.length} release(s) imported.`, C.green);
  };
  const handleSimulateSignal = (sourceId) => {
    const src = SIGNAL_SOURCES.find((s) => s.id === sourceId);
    if (!src) return;
    const arrivedAt = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    setReleases((p) => p.map((r) => {
      if (r.id !== selectedId) return r;
      const newSources = (r.sources || []).map((s) => s.id === sourceId ? { ...s, status: "arrived", arrivedAt } : s);
      const newSignals = { ...r.signals, ...src.demoValues };
      return { ...r, sources: newSources, signals: newSignals };
    }));
    showToast(`${src.name} — ${src.signals.length} signal${src.signals.length !== 1 ? "s" : ""} received`, C.green);
  };
  const handleRunVerdict = async () => {
    const active = releases.find((r) => r.id === selectedId);
    if (!active) return;
    const backendId = active.backendReleaseId || active.id;
    if (hasBackend() && backendId) {
      try {
        setApiBanner(null);
        const flat = {};
        Object.entries(active.signals || {}).forEach(([k, v]) => {
          if (typeof v === "number") flat[k] = v;
        });
        const out = await apiPost(
          `/api/releases/${backendId}/signals`,
          {
            source: "dashboard_manual",
            signals: flat
          },
          { navigate }
        );
        await refreshReleaseFromBackend(backendId);
        await refreshAuditFromServer();
        const miss = Array.isArray(out.missing_signals) ? out.missing_signals.length : 0;
        const th = Array.isArray(out.threshold_failed_signals) ? out.threshold_failed_signals.length : 0;
        if (miss || th) {
          showToast(`Verdict: ${miss ? `${miss} missing` : ""}${miss && th ? " · " : ""}${th ? `${th} below threshold` : ""}`, th ? C.amber : C.green);
        } else {
          showToast("All required signals passed thresholds", C.green);
        }
        if (out.assistive_enrichment_pending) {
          window.setTimeout(() => {
            void refreshReleaseFromBackend(backendId);
          }, 4500);
        }
      } catch (e) {
        setApiBanner(e.message || "Signal ingest failed");
        showToast("Backend ingest failed — check banner or try again", C.red);
        return;
      }
    }
    setReleases((p) => p.map((r) => r.id === selectedId ? { ...r, status: "pending" } : r));
    if (!hasBackend() || !backendId) showToast("All signals collected — verdict ready", C.green);
  };
  const handleConfirmReevaluation = async () => {
    if (reEvaluating) return;
    setReEvaluating(true);
    try {
      setShowReevalConfirm(false);
      await handleRunVerdict();
    } finally {
      setReEvaluating(false);
    }
  };
  const pendingRelease = releases.find((r) => r.status === "pending");
  const navItems = [{
    id: "release",
    label: "Release Signals",
    icon: "◈"
  }, {
    id: "trend",
    label: "Trend",
    icon: "∿"
  }, {
    id: "thresholds",
    label: "Thresholds",
    icon: "⌗"
  }, {
    id: "audit",
    label: "Audit Trail",
    icon: "≡"
  }, {
    id: "intelligence",
    label: "Intelligence",
    icon: "⊹"
  }, {
    id: "settings",
    label: "Settings",
    icon: "⚙"
  }];
  const ReleaseView = () => /* @__PURE__ */ React.createElement(ReleaseViewPanel, {
    current,
    releases: sortedReleasesForSidebar,
    formatReleaseAge: formatSidebarReleaseAge,
    thresholds,
    releaseTypes: RELEASE_TYPES,
    signalCategories: SIGNAL_CATEGORIES,
    calcCategoryStatus,
    setDetailCat,
    setShowStartCert,
    onViewFullRecord: setAuditDetail,
    onBeginOverride: (release) => {
      if (release?.id) setSelectedId(release.id);
      setShowOverride(true);
    },
    handleSimulateSignal,
    handleRunVerdict,
    signalSources: SIGNAL_SOURCES,
    releaseVersionPrimarySecondary,
    onCollectingAction: async (kind) => {
      if (kind === "live") {
        showToast(
          "Live stream: signal events appear when webhooks are connected. Configure ingest under Settings → API & workspace.",
          C.accent
        );
        return;
      }
      if (kind === "extend") {
        showToast(
          "Extend deadline: updates the server-side collection window (requires backend release in COLLECTING).",
          C.amber
        );
        return;
      }
      if (kind === "pull") {
        const active = releases.find((r) => r.id === selectedId);
        const backendId = active?.backendReleaseId || (typeof active?.id === "string" && active.id.startsWith("rel_") ? active.id : null);
        if (!hasBackend() || !backendId) {
          showToast("Sign in and open a server-backed release to pull metrics from connected integrations (Settings → Signal sources).", C.amber);
          return;
        }
        try {
          const out = await apiPost(`/api/releases/${backendId}/sources/pull`, {}, { navigate });
          const src = out.sources || {};
          const parts = Object.entries(src).map(([k, v]) => {
            if (v && v.ok) return `${k}: ok`;
            if (v && v.skipped) return `${k}: skipped`;
            if (v && v.error) return `${k}: ${v.error}`;
            return `${k}: done`;
          });
          showToast(parts.length ? parts.join(" · ") : out.message || "Pull finished.", C.accent);
          await refreshReleaseFromBackend(backendId);
        } catch (e) {
          showToast(e?.message || "Pull failed", C.red);
        }
      }
    }
  });

  const TrendView = () => {
    return /* @__PURE__ */ React.createElement(TrendViewPanel, {
      releases,
      signalCategories: SIGNAL_CATEGORIES,
      thresholds,
      trendChartMaxPoints: TREND_CHART_MAX_POINTS,
      getRegressionRequired,
      evaluateSignal,
      calcCategoryStatus,
      catStatusColor,
      trendChartXLabel,
      formatReleaseDisplayName
    });
  };
  const ThresholdsView = () => {
    return /* @__PURE__ */ React.createElement(ThresholdsViewPanel, {
      thresholds,
      signalCategories: SIGNAL_CATEGORIES,
      isMobile,
      currentUser,
      canAct,
      onSave: async (local) => {
        setThresholds(local);
        if (!hasBackend()) S.set("thresholds", local);
        if (hasBackend()) {
          try {
            const payload = {};
            Object.entries(local).forEach(([signalId, value]) => {
              if (typeof value !== "number") return;
              const isLatency = signalId === "p95latency" || signalId === "p99latency";
              payload[signalId] = isLatency ? { min: null, max: value } : { min: value, max: null };
            });
            await apiPost(`/api/workspaces/${getWorkspaceId()}/thresholds`, { thresholds: payload }, { navigate });
            setApiBanner(null);
            await refreshWorkspaceFromServer();
          } catch (e) {
            setApiBanner(e.message || "Failed to save thresholds");
          }
        } else {
          addAudit({
            ts: nowTs(),
            event: "Thresholds updated",
            release: "—",
            actor: "You",
            detail: "Signal thresholds updated."
          });
        }
      }
    });
  };
  const AuditView = () => /* @__PURE__ */ React.createElement(AuditViewPanel, {
    auditLog,
    releases,
    isMobile,
    onSelectRelease: setAuditDetail
  });
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(ApiBanner, {
    message: apiBanner,
    onDismiss: () => setApiBanner(null)
  }),
  /* @__PURE__ */ React.createElement(LoopReadinessNudge, {
    visible: showLoopNudge,
    apiBannerVisible: !!apiBanner,
    onDismiss: dismissLoopNudge,
    onConnect: () => {
      dismissLoopNudge();
      navigate("/settings");
    }
  }),
  /* @__PURE__ */ React.createElement("div", {
    style: {
      display: "flex",
      height: isMobile ? "auto" : apiBanner ? "calc(100vh - 48px)" : "100vh",
      minHeight: apiBanner ? "calc(100vh - 48px)" : "100vh",
      flexDirection: isMobile ? "column" : "row",
      background: C.bg,
      fontFamily: C.sans,
      color: C.text,
      overflow: isMobile ? "auto" : "hidden"
    }
  }, /* @__PURE__ */ React.createElement(Sidebar, {
    isMobile,
    project,
    nav,
    navItems,
    styles: T,
    dataStrongStyle: T.dataStrong,
    overlineStyle: T.overline,
    releaseSidebarCounts,
    hasBackend,
    workspaceSyncing,
    refreshWorkspaceFromServer,
    sidebarReleaseGroups,
    collapsedSidebarDayKeys,
    setCollapsedSidebarDayKeys,
    selectedId,
    setSelectedId,
    sidebarRecById,
    releaseTypes: RELEASE_TYPES,
    formatSidebarReleaseAge,
    sidebarStatusLabel,
    releaseRiskScore,
    thresholds,
    formatReleaseDisplayName,
    currentUser,
    canAct,
    showReevalConfirm,
    setShowReevalConfirm,
    reEvaluating,
    handleConfirmReevaluation,
    setShowStartCert,
    onNavigate: (id) => {
      if (id === "settings") navigate("/settings");
      else if (id === "intelligence") navigate("/intelligence");
      else
        navigate(NAV_TO_PATH[id] || "/releases");
    },
    roles: ROLES,
    pendingRelease,
    setCurrentUser,
    setLocalStore: S.set,
    onLogout: () => {
      localStorage.removeItem("vdk3_currentUser");
      localStorage.removeItem("vdk3_auth_token");
      window.location.href = "/login";
    }
    }),
    /* @__PURE__ */ React.createElement(AppContentSwitch, {
      isMobile,
      nav,
      ReleaseView,
      TrendView,
      ThresholdsView,
      AuditView
    }),
    !currentUser && /* @__PURE__ */ React.createElement(UserSetupModal, {
      roles: ROLES,
      onSave: (user) => {
        S.set("currentUser", user);
        setCurrentUser(user);
      }
    }),
    showStartCert && /* @__PURE__ */ React.createElement(StartCertModal, {
      onClose: () => setShowStartCert(false),
      onStart: handleStartCert,
      releaseTypes: RELEASE_TYPES
    }),
    showManualAdd && /* @__PURE__ */ React.createElement(ManualAddModal, {
      onClose: () => setShowManualAdd(false),
      onAddSingle: handleManualAddSingle,
      onImportCSV: handleManualImportCSV,
      releaseTypes: RELEASE_TYPES
    }),
    showOverride && current && /* @__PURE__ */ React.createElement(OverrideModal, {
      key: current.backendReleaseId || current.id,
      release: current,
      thresholds,
      currentUser,
      onClose: () => setShowOverride(false),
      onConfirm: handleOverrideConfirm,
      roles: ROLES,
      calcVerdict,
      fmtVal,
      buildRegressionOverrideContext,
      findSignalMetaById,
      formatAiPct,
      scoreJustification
    }),
    detailCat && current && /* @__PURE__ */ React.createElement(SignalDetailPanel, {
      catId: detailCat,
      release: current,
      thresholds,
      releaseType: current.releaseType,
      onClose: () => setDetailCat(null)
    }),
    auditDetail && /* @__PURE__ */ React.createElement(CertificationRecordModal, {
      release: auditDetail,
      thresholds,
      onClose: () => setAuditDetail(null),
      onShareSnapshot: (r) => {
        setShareRelease(r);
        setShowShare(true);
      },
      calcVerdict,
      releaseTypes: RELEASE_TYPES,
      signalCategories: SIGNAL_CATEGORIES,
      calcCategoryStatus,
      catStatusColor,
      getRegressionRequired,
      evaluateSignal,
      fmtVal,
      backendReleaseId: auditDetail.backendReleaseId || auditDetail.id
    }),
    showShare && shareRelease && /* @__PURE__ */ React.createElement(ShareModal, {
      release: shareRelease,
      thresholds,
      project,
      onClose: () => {
        setShowShare(false);
        setShareRelease(null);
      },
      calcVerdict,
      calcCategoryStatus,
      releaseTypes: RELEASE_TYPES,
      signalCategories: SIGNAL_CATEGORIES,
      catStatusColor,
      fmtVal,
      genCertSummary
    }),
    toast && /* @__PURE__ */ React.createElement("div", {
      className: "fade-up",
      style: {
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
      }
    }, toast.msg)
  ));
}
