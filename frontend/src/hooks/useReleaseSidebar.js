import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { getWorkspaceId } from "../lib/apiClient.js";
import { normalizeLegacyUiStatus, UI_RELEASE_STATUS } from "../lib/releaseStatus.js";
import {
  calcVerdict,
  formatSidebarDayHeading,
  releaseDayKeyLocal,
  releaseSortTimestampMs,
  semverDesc
} from "../app/main/appMainLogic.js";

export function useReleaseSidebar(releases, thresholds, nav) {
  const [collapsedSidebarDayKeys, setCollapsedSidebarDayKeys] = React.useState(() => new Set());
  const sidebarCollapsedInitializedForWs = useRef(null);
  const knownSidebarDayKeysRef = useRef(new Set());
  const prevNavRef = useRef(nav);

  const sortedReleasesForSidebar = useMemo(() => {
    return [...releases].sort((a, b) => {
      const ta = releaseSortTimestampMs(a);
      const tb = releaseSortTimestampMs(b);
      if (ta != null && tb != null && ta !== tb) return tb - ta;
      if (ta != null && tb == null) return -1;
      if (ta == null && tb != null) return 1;
      return semverDesc(a.version, b.version);
    });
  }, [releases]);

  const sidebarReleaseGroups = useMemo(() => {
    const byDay = new Map();
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

  const releaseSidebarCounts = useMemo(() => {
    const nCert = releases.filter((r) => normalizeLegacyUiStatus(r.status) === UI_RELEASE_STATUS.CERTIFIED).length;
    const nUncertified = releases.filter((r) => normalizeLegacyUiStatus(r.status) === UI_RELEASE_STATUS.UNCERTIFIED).length;
    const nProgress = releases.filter((r) => normalizeLegacyUiStatus(r.status) === UI_RELEASE_STATUS.COLLECTING).length;
    const nOv = releases.filter((r) => normalizeLegacyUiStatus(r.status) === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE).length;
    const nPassed = nCert + nOv;
    const nTotal = releases.length;
    return { nCert, nUncertified, nProgress, nOv, nPassed, nTotal };
  }, [releases]);

  const sidebarRecById = useMemo(() => {
    const m = new Map();
    for (const r of sortedReleasesForSidebar) {
      m.set(r.id, calcVerdict(r.signals, thresholds, r.releaseType).recommendation);
    }
    return m;
  }, [sortedReleasesForSidebar, thresholds]);

  return {
    sortedReleasesForSidebar,
    sidebarReleaseGroups,
    collapsedSidebarDayKeys,
    setCollapsedSidebarDayKeys,
    releaseSidebarCounts,
    sidebarRecById
  };
}
